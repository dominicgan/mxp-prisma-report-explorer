import type { Finding, ReportMeta, SheetInfo } from './parse'

/**
 * Parsed reports cached in IndexedDB, keyed by file content + sheet.
 *
 * Measured on a real 91,578-row export: re-parsing costs ~12s in the worker,
 * while reading the parsed rows back costs about a second. These reports arrive
 * on a cadence and get reopened, so this is the difference between a tool you
 * keep open and one you avoid reloading.
 *
 * Rows are stored in chunks rather than as one record because Chrome rejects a
 * single IndexedDB value over ~127MB, and this report serialises to ~235MB:
 *
 *   tx abort UnknownError "The serialized keys and/or value are too large
 *   (size=235438591 bytes, max=133169152 bytes)"
 *
 * Bump CACHE_VERSION whenever the parser's output shape or derived fields
 * change, so stale entries are ignored rather than silently served.
 */
const DB_NAME = 'prisma-explorer'
const STORE = 'reports'
const DB_VERSION = 1

/** Derived fields and schema changes invalidate cached rows. */
export const CACHE_VERSION = 4

/** Keep the cache bounded; these entries run to hundreds of MB each. */
const MAX_ENTRIES = 3

/**
 * Rows per stored chunk. 10k rows of this shape serialises to roughly 26MB,
 * comfortably inside the per-record ceiling with room for wider exports.
 */
const CHUNK_ROWS = 10_000

interface HeaderRecord {
  key: string
  kind: 'header'
  version: number
  savedAt: number
  rowCount: number
  chunkCount: number
  meta: ReportMeta
  /** The workbook's sheet summaries, so a cache hit can skip inspection. */
  sheets: SheetInfo[]
}

interface ChunkRecord {
  key: string
  kind: 'chunk'
  rows: Finding[]
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    // Private mode and storage-policy failures are not worth surfacing; the
    // report simply re-parses.
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

function baseKey(fileKey: string, sheetName: string) {
  return `${fileKey}::${sheetName}`
}
function chunkKey(base: string, i: number) {
  return `${base}#${i}`
}

function get<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const r = store.get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => resolve(undefined)
  })
}

/** Let pending input and paint run before continuing. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export async function readCachedReport(
  fileKey: string,
  sheetName: string,
  onProgress?: (pct: number) => void,
): Promise<{ rows: Finding[]; meta: ReportMeta; sheets: SheetInfo[] } | null> {
  const db = await openDb()
  if (!db) return null
  const base = baseKey(fileKey, sheetName)
  const readStore = () => db.transaction(STORE, 'readonly').objectStore(STORE)
  try {
    const header = await get<HeaderRecord>(readStore(), base)
    if (!header || header.version !== CACHE_VERSION) return null

    // Read chunks one at a time, yielding in between. Requesting them all at
    // once completes them back-to-back in a single task, and deserialising
    // ~90k rows in one burst blocks the main thread for seconds; this spreads
    // it into slices the UI can breathe between.
    const rows: Finding[] = []
    for (let i = 0; i < header.chunkCount; i++) {
      // A new transaction per chunk: yielding lets the previous one finish.
      const chunk = await get<ChunkRecord>(readStore(), chunkKey(base, i))
      // A partially-evicted entry is a miss, not a short report.
      if (!chunk) return null
      for (const r of chunk.rows) rows.push(r)
      onProgress?.((i + 1) / header.chunkCount)
      await yieldToUi()
    }
    if (rows.length !== header.rowCount) return null

    return { rows, meta: header.meta, sheets: header.sheets ?? [] }
  } catch {
    return null
  } finally {
    db.close()
  }
}

export async function writeCachedReport(
  fileKey: string,
  sheetName: string,
  rows: Finding[],
  meta: ReportMeta,
  sheets: SheetInfo[],
): Promise<void> {
  const db = await openDb()
  if (!db) return
  const base = baseKey(fileKey, sheetName)
  const chunkCount = Math.max(1, Math.ceil(rows.length / CHUNK_ROWS))
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)

      for (let i = 0; i < chunkCount; i++) {
        store.put({
          key: chunkKey(base, i),
          kind: 'chunk',
          rows: rows.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS),
        } satisfies ChunkRecord)
      }
      // Header last: if the transaction dies partway, there is no header and
      // the entry reads as a miss rather than as a truncated report.
      store.put({
        key: base,
        kind: 'header',
        version: CACHE_VERSION,
        savedAt: Date.now(),
        rowCount: rows.length,
        chunkCount,
        meta,
        sheets,
      } satisfies HeaderRecord)

      tx.oncomplete = () => resolve()
      // Quota and per-record size failures are expected on very large reports
      // and are not something the user needs to act on - the report is already
      // on screen, it just will not load instantly next time.
      tx.onerror = () => {
        console.warn('[report-cache] write failed:', tx.error?.name, tx.error?.message)
        resolve()
      }
      tx.onabort = () => {
        console.warn('[report-cache] write aborted:', tx.error?.name, tx.error?.message)
        resolve()
      }
    })
    await evictOldest(db)
  } finally {
    db.close()
  }
}

async function deleteEntry(store: IDBObjectStore, base: string) {
  store.delete(base)
  // Chunks sort directly after the header key under the '#' suffix.
  store.delete(IDBKeyRange.bound(`${base}#`, `${base}#￿`))
}

async function evictOldest(db: IDBDatabase): Promise<void> {
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const req = store.getAllKeys()
    req.onsuccess = () => {
      const bases = (req.result as string[]).filter((k) => !k.includes('#'))
      if (bases.length <= MAX_ENTRIES) {
        resolve()
        return
      }
      // Read only the small header records to rank them; getAll would pull
      // every cached row back into memory purely to sort by date.
      let remaining = bases.length
      const headers: { key: string; savedAt: number }[] = []
      for (const k of bases) {
        const g = store.get(k)
        g.onsuccess = () => {
          const h = g.result as HeaderRecord | undefined
          if (h) headers.push({ key: h.key, savedAt: h.savedAt })
          if (--remaining === 0) {
            headers.sort((a, b) => a.savedAt - b.savedAt)
            for (const h of headers.slice(0, headers.length - MAX_ENTRIES)) void deleteEntry(store, h.key)
            resolve()
          }
        }
        g.onerror = () => {
          if (--remaining === 0) resolve()
        }
      }
    }
    req.onerror = () => resolve()
  })
}

export async function clearReportCache(): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}
