import type { Finding } from './parse'
import { DERIVED_DATE_KEYS, DERIVED_NUMBER_KEYS, FIELDS } from './schema'

/**
 * Columnar, dictionary-encoded index over the parsed rows.
 *
 * Filtering and facet counting used to walk 91,578 row objects and touch string
 * properties: ~140ms per filter change, which is felt on every click. This
 * stores each column as integer codes into a per-column string dictionary, so
 * the same work becomes integer comparisons over typed arrays.
 *
 * The shape of the real data is what makes this pay off: a 30MB export carries
 * 4.5M cell references but only ~5,700 distinct strings. Every string column
 * dictionary-encodes tightly, and - more usefully - a free-text search can be
 * resolved against a few thousand dictionary entries instead of 91k rows.
 *
 * This sits *beside* the row objects rather than replacing them: the grid, the
 * charts and the detail sheet still take `Finding` objects. It is an index, not
 * a storage migration.
 */

/** A string column: codes index into `dict`. Blank is stored as `''`. */
export interface DictColumn {
  kind: 'dict'
  dict: string[]
  /** Narrowed to Uint16Array whenever the dictionary fits. */
  codes: Uint16Array | Uint32Array
}

/** A numeric or date column. Missing values are NaN; dates are epoch ms. */
export interface NumColumn {
  kind: 'num'
  values: Float64Array
}

export type Column = DictColumn | NumColumn

export interface ColumnStore {
  rowCount: number
  columns: Record<string, Column>
  /** Dict columns free-text search looks at. */
  searchKeys: string[]
}

/** The blank placeholder the facet UI shows and filters round-trip through. */
export const BLANK = '(blank)'

export function displayValue(raw: string): string {
  return raw === '' ? BLANK : raw
}
function storedValue(display: string): string {
  return display === BLANK ? '' : display
}

/** Derived columns the schema doesn't describe as sheet fields. */
const DERIVED_DICT = [
  'surface', 'exploitable', 'patchable', 'triage', 'ageBucket',
  'tagStream', 'tagVersion', 'imageAgeBucket',
]
const DERIVED_NUM = [...DERIVED_NUMBER_KEYS, ...DERIVED_DATE_KEYS]

/** Kept in step with the old row-scan implementation's search coverage. */
const SEARCH_KEYS = [
  'cve', 'bulletin', 'repo', 'tag', 'tagStream', 'packageName', 'packageVersion', 'packagePath',
  'purl', 'namespace', 'cluster', 'hostName', 'serviceName', 'description',
  'imageId', 'digestId', 'ciNumber', 'serviceOwner', 'status',
]

function toCodes(codes: number[], dictSize: number): Uint16Array | Uint32Array {
  return dictSize <= 0xffff ? Uint16Array.from(codes) : Uint32Array.from(codes)
}

export function buildStore(rows: Finding[]): ColumnStore {
  const rowCount = rows.length

  const numKeys = new Set<string>([...DERIVED_NUM])
  const dictKeys = new Set<string>([...DERIVED_DICT])
  for (const f of FIELDS) {
    if (f.kind === 'number') numKeys.add(f.key)
    else if (f.kind === 'date') numKeys.add(f.key)
    else dictKeys.add(f.key)
  }

  const columns: Record<string, Column> = {}

  for (const key of dictKeys) {
    const dict: string[] = []
    const index = new Map<string, number>()
    const codes = new Array<number>(rowCount)
    for (let i = 0; i < rowCount; i++) {
      const raw = rows[i][key]
      const v = raw == null ? '' : String(raw)
      let c = index.get(v)
      if (c === undefined) {
        c = dict.length
        dict.push(v)
        index.set(v, c)
      }
      codes[i] = c
    }
    columns[key] = { kind: 'dict', dict, codes: toCodes(codes, dict.length) }
  }

  const isDate = new Set([...FIELDS.filter((f) => f.kind === 'date').map((f) => f.key), ...DERIVED_DATE_KEYS])
  for (const key of numKeys) {
    const values = new Float64Array(rowCount)
    const dateCol = isDate.has(key)
    for (let i = 0; i < rowCount; i++) {
      const raw = rows[i][key]
      if (raw == null || raw === '') {
        values[i] = Number.NaN
      } else if (dateCol) {
        const t = Date.parse(String(raw))
        values[i] = Number.isNaN(t) ? Number.NaN : t
      } else {
        const n = Number(raw)
        values[i] = Number.isFinite(n) ? n : Number.NaN
      }
    }
    columns[key] = { kind: 'num', values }
  }

  const searchKeys = SEARCH_KEYS.filter((k) => columns[k]?.kind === 'dict')
  return { rowCount, columns, searchKeys }
}

export function dictColumn(store: ColumnStore, key: string): DictColumn | null {
  const c = store.columns[key]
  return c && c.kind === 'dict' ? c : null
}
export function numColumn(store: ColumnStore, key: string): NumColumn | null {
  const c = store.columns[key]
  return c && c.kind === 'num' ? c : null
}

/** Rough resident size, for the report-details panel. */
export function storeBytes(store: ColumnStore): number {
  let bytes = 0
  for (const col of Object.values(store.columns)) {
    if (col.kind === 'num') bytes += col.values.byteLength
    else {
      bytes += col.codes.byteLength
      for (const s of col.dict) bytes += s.length * 2 + 16
    }
  }
  return bytes
}

// --- predicate compilation ------------------------------------------------

/** `allowed[code] === 1` for the values this constraint admits. */
export interface CodeMask {
  key: string
  codes: Uint16Array | Uint32Array
  allowed: Uint8Array
}

/**
 * Turn a facet's selected display values into a lookup over that column's
 * dictionary. Done once per filter change rather than per row.
 */
export function compileFacetMask(store: ColumnStore, key: string, selected: string[]): CodeMask | 'none' | 'all' {
  if (selected.length === 0) return 'all'
  const col = dictColumn(store, key)
  if (!col) {
    // No such column: every row reads as blank, so the constraint admits
    // everything or nothing depending on whether blank was selected.
    return selected.includes(BLANK) ? 'all' : 'none'
  }
  const wanted = new Set(selected.map(storedValue))
  const allowed = new Uint8Array(col.dict.length)
  for (let c = 0; c < col.dict.length; c++) {
    if (wanted.has(col.dict[c])) allowed[c] = 1
  }
  // A selection matching no dictionary entry stays a real mask that admits
  // nothing, rather than collapsing the whole query. Row selection then yields
  // nothing (correct), while facet counting still reports values for *this*
  // facet - which ignores its own constraint - and that is what the row-scan
  // implementation does.
  return { key, codes: col.codes, allowed }
}

/**
 * Rows matching every search term.
 *
 * A term is matched against each searchable column's *dictionary* first, which
 * is a few thousand comparisons; the per-row work is then an integer lookup.
 */
export function compileSearch(store: ColumnStore, terms: string[]): Uint8Array | null {
  if (terms.length === 0) return null
  const n = store.rowCount
  let acc: Uint8Array | null = null

  for (const term of terms) {
    const hit = new Uint8Array(n)
    for (const key of store.searchKeys) {
      const col = dictColumn(store, key)
      if (!col) continue
      const allowed = new Uint8Array(col.dict.length)
      let any = false
      for (let c = 0; c < col.dict.length; c++) {
        if (col.dict[c].toLowerCase().includes(term)) {
          allowed[c] = 1
          any = true
        }
      }
      if (!any) continue
      const codes = col.codes
      for (let i = 0; i < n; i++) {
        if (hit[i] === 0 && allowed[codes[i]] === 1) hit[i] = 1
      }
    }
    if (acc === null) acc = hit
    else for (let i = 0; i < n; i++) acc[i] &= hit[i]
  }
  return acc
}

export interface RangeSpec {
  values: Float64Array
  min: number
  max: number
  /** Rows with no value fail the constraint, matching the row-scan behaviour. */
  requirePresent: true
}

export function compileRange(
  store: ColumnStore,
  key: string,
  min: number | undefined,
  max: number | undefined,
): RangeSpec | null | 'none' {
  if (min == null && max == null) return null
  const col = numColumn(store, key)
  if (!col) return 'none'
  return {
    values: col.values,
    min: min ?? Number.NEGATIVE_INFINITY,
    max: max ?? Number.POSITIVE_INFINITY,
    requirePresent: true,
  }
}
