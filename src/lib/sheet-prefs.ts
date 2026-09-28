import { hashKey } from './parse'

/**
 * Remembers which sheet to read out of a multi-sheet workbook.
 *
 * Two levels, because "the same file" means two different things in practice:
 *
 *   1. **byFile** - keyed on the file's *content*, so re-uploading the identical
 *      workbook goes straight to the sheet you picked last time, even if the
 *      file has been renamed or moved.
 *   2. **recentNames** - the sheet names you have chosen before. A fresh export
 *      has different bytes and so misses the content key, but its tabs are
 *      usually named the same, so a known name is pre-selected for you.
 */
export interface SheetPrefs {
  /** content key -> sheet name */
  byFile: Record<string, string>
  /** sheet names chosen before, most recent first */
  recentNames: string[]
}

const STORAGE_KEY = 'prisma-explorer.sheet-prefs'
const MAX_FILES = 50
const MAX_NAMES = 10

const EMPTY: SheetPrefs = { byFile: {}, recentNames: [] }

export function loadPrefs(): SheetPrefs {
  if (typeof localStorage === 'undefined') return EMPTY
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<SheetPrefs>
    return {
      byFile: parsed.byFile && typeof parsed.byFile === 'object' ? parsed.byFile : {},
      recentNames: Array.isArray(parsed.recentNames) ? parsed.recentNames.filter((n) => typeof n === 'string') : [],
    }
  } catch {
    // A corrupt or foreign value in this key should never block loading a report.
    return EMPTY
  }
}

function savePrefs(p: SheetPrefs) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch {
    // Quota or private-mode failures are not worth surfacing: the choice simply
    // will not be remembered next time.
  }
}

/**
 * A stable content key for a workbook.
 *
 * Uses SHA-256 where available. `crypto.subtle` needs a secure context, which
 * localhost is - but a dev server reached over a plain-HTTP LAN address is not,
 * so there is a synchronous fallback. Both are deterministic: the same bytes
 * always produce the same key.
 */
export async function fileKey(data: ArrayBuffer): Promise<string> {
  const size = data.byteLength
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', data)
      const hex = [...new Uint8Array(digest).slice(0, 12)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      return `${size.toString(36)}-${hex}`
    } catch {
      // fall through to the sampling hash
    }
  }
  return `${size.toString(36)}-${sampledHash(data)}`
}

/**
 * Hash the whole buffer when it is small, otherwise three fixed windows plus the
 * length. Deterministic, and cheap enough not to stall a large upload.
 */
function sampledHash(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  const WINDOW = 512 * 1024
  if (bytes.length <= 2 * WINDOW) return hashKey(String.fromCharCode(...chunked(bytes)))

  const mid = Math.floor(bytes.length / 2 - WINDOW / 2)
  const parts = [
    bytes.subarray(0, WINDOW),
    bytes.subarray(mid, mid + WINDOW),
    bytes.subarray(bytes.length - WINDOW),
  ]
  return parts.map((p) => hashKey(String.fromCharCode(...chunked(p)))).join('')
}

/** String.fromCharCode blows the stack on large spreads; step through instead. */
function chunked(bytes: Uint8Array): number[] {
  const out: number[] = []
  // Every 7th byte is plenty of signal for a preference key and keeps this fast.
  for (let i = 0; i < bytes.length; i += 7) out.push(bytes[i])
  return out
}

export interface Recall {
  sheetName: string
  /** Why this sheet was suggested - shown to the user, never silent. */
  source: 'file' | 'name'
}

/**
 * Resolve a remembered sheet against the sheets this workbook actually has.
 * A remembered sheet that no longer exists is ignored rather than erroring.
 */
export function recallSheet(key: string, available: string[]): Recall | null {
  const prefs = loadPrefs()
  const exact = prefs.byFile[key]
  if (exact && available.includes(exact)) return { sheetName: exact, source: 'file' }

  for (const name of prefs.recentNames) {
    if (available.includes(name)) return { sheetName: name, source: 'name' }
  }
  return null
}

export function rememberSheet(key: string, sheetName: string) {
  const prefs = loadPrefs()

  const byFile = { ...prefs.byFile, [key]: sheetName }
  // Bound the store: drop the oldest entries once it gets long.
  const keys = Object.keys(byFile)
  if (keys.length > MAX_FILES) {
    for (const k of keys.slice(0, keys.length - MAX_FILES)) delete byFile[k]
  }

  const recentNames = [sheetName, ...prefs.recentNames.filter((n) => n !== sheetName)].slice(0, MAX_NAMES)
  savePrefs({ byFile, recentNames })
}

export function forgetFile(key: string) {
  const prefs = loadPrefs()
  if (!(key in prefs.byFile)) return
  const byFile = { ...prefs.byFile }
  delete byFile[key]
  savePrefs({ ...prefs, byFile })
}

export function forgetAll() {
  savePrefs(EMPTY)
}
