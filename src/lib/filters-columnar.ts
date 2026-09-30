import {
  BLANK,
  compileFacetMask,
  compileRange,
  compileSearch,
  dictColumn,
  displayValue,
  type CodeMask,
  type ColumnStore,
  type RangeSpec,
} from './columnar'
import type { FacetValue, FilterState } from './filters'
import type { Finding } from './parse'

/**
 * Columnar implementations of the two operations that run on every filter
 * change. Same results as the row-scan versions in `filters.ts`, but the
 * per-row work is integer comparisons over typed arrays instead of property
 * reads and string comparisons.
 */

interface Compiled {
  /** Facet constraints that actually narrow anything. */
  masks: CodeMask[]
  /** Set when some constraint admits nothing, so the whole result is empty. */
  empty: boolean
  search: Uint8Array | null
  cvss: RangeSpec | null
  discovered: RangeSpec | null
  cveOnlyMask: CodeMask | null
}

function compile(store: ColumnStore, f: FilterState, exclude?: string): Compiled {
  const out: Compiled = {
    masks: [],
    empty: false,
    search: null,
    cvss: null,
    discovered: null,
    cveOnlyMask: null,
  }

  for (const [key, values] of Object.entries(f.facets)) {
    if (values.length === 0 || key === exclude) continue
    const m = compileFacetMask(store, key, values)
    if (m === 'none') {
      out.empty = true
      return out
    }
    if (m !== 'all') out.masks.push(m)
  }

  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  out.search = compileSearch(store, terms)

  const cvss = compileRange(store, 'cvss', f.cvssMin, f.cvssMax)
  if (cvss === 'none') {
    out.empty = true
    return out
  }
  out.cvss = cvss

  const from = f.discoveredFrom ? Date.parse(`${f.discoveredFrom}T00:00:00Z`) : undefined
  const to = f.discoveredTo ? Date.parse(`${f.discoveredTo}T23:59:59.999Z`) : undefined
  const disc = compileRange(store, 'discovered', from, to)
  if (disc === 'none') {
    out.empty = true
    return out
  }
  out.discovered = disc

  if (f.cveOnly) {
    // "Has a CVE" is "the cve column is not blank", which is one dictionary
    // entry - so it compiles to the same integer lookup as any other facet.
    const col = dictColumn(store, 'cve')
    if (!col) {
      out.empty = true
      return out
    }
    const allowed = new Uint8Array(col.dict.length)
    let any = false
    for (let c = 0; c < col.dict.length; c++) {
      if (col.dict[c] !== '') {
        allowed[c] = 1
        any = true
      }
    }
    if (!any) {
      out.empty = true
      return out
    }
    out.cveOnlyMask = { key: 'cve', codes: col.codes, allowed }
  }

  return out
}

function inRange(spec: RangeSpec, i: number): boolean {
  const v = spec.values[i]
  if (Number.isNaN(v)) return false
  return v >= spec.min && v <= spec.max
}

/** Everything except the per-facet value constraints. */
function passesNonFacet(c: Compiled, i: number): boolean {
  if (c.search !== null && c.search[i] === 0) return false
  if (c.cveOnlyMask !== null && c.cveOnlyMask.allowed[c.cveOnlyMask.codes[i]] === 0) return false
  if (c.cvss !== null && !inRange(c.cvss, i)) return false
  if (c.discovered !== null && !inRange(c.discovered, i)) return false
  return true
}

/** Row indices surviving the filter, in original order. */
export function selectIndices(store: ColumnStore, f: FilterState, exclude?: string): Uint32Array {
  const c = compile(store, f, exclude)
  if (c.empty) return new Uint32Array(0)

  const n = store.rowCount
  const out = new Uint32Array(n)
  let k = 0

  outer: for (let i = 0; i < n; i++) {
    if (!passesNonFacet(c, i)) continue
    for (let m = 0; m < c.masks.length; m++) {
      const mask = c.masks[m]
      if (mask.allowed[mask.codes[i]] === 0) continue outer
    }
    out[k++] = i
  }
  return out.subarray(0, k)
}

export function selectRows(rows: Finding[], store: ColumnStore, f: FilterState): Finding[] {
  const idx = selectIndices(store, f)
  const out = new Array<Finding>(idx.length)
  for (let i = 0; i < idx.length; i++) out[i] = rows[idx[i]]
  return out
}

/**
 * Facet counts for several facets in one pass.
 *
 * Same fail-count trick as the row-scan version - a row failing no facet
 * constraint counts toward every facet, failing exactly one counts toward that
 * one, failing two or more counts toward none - but the tallies are integer
 * histograms indexed by dictionary code, so there is no string hashing per row.
 */
export function facetCounts(
  store: ColumnStore,
  f: FilterState,
  keys: string[],
  limit = 500,
): Map<string, FacetValue[]> {
  const c = compile(store, f)
  const out = new Map<string, FacetValue[]>()

  const targets = keys.map((key) => {
    const col = dictColumn(store, key)
    return col ? { key, col, hist: new Uint32Array(col.dict.length) } : { key, col: null, hist: null }
  })
  const maskIndexByKey = new Map(c.masks.map((m, i) => [m.key, i]))

  if (!c.empty) {
    const n = store.rowCount
    for (let i = 0; i < n; i++) {
      if (!passesNonFacet(c, i)) continue

      let failCount = 0
      let failedKey = ''
      for (let m = 0; m < c.masks.length; m++) {
        const mask = c.masks[m]
        if (mask.allowed[mask.codes[i]] === 0) {
          failCount++
          if (failCount > 1) break
          failedKey = mask.key
        }
      }
      if (failCount > 1) continue

      if (failCount === 0) {
        for (const t of targets) {
          if (t.col && t.hist) t.hist[t.col.codes[i]]++
        }
      } else if (maskIndexByKey.has(failedKey)) {
        const t = targets.find((x) => x.key === failedKey)
        if (t?.col && t.hist) t.hist[t.col.codes[i]]++
      }
    }
  }

  for (const t of targets) {
    const selected = new Set(f.facets[t.key] ?? [])
    const values: FacetValue[] = []
    if (t.col && t.hist) {
      for (let code = 0; code < t.col.dict.length; code++) {
        const count = t.hist[code]
        const value = displayValue(t.col.dict[code])
        if (count === 0 && !selected.has(value)) continue
        values.push({ value, count, selected: selected.has(value) })
      }
    }
    // Selected values always appear, even at count 0, so they stay
    // un-selectable-away.
    for (const v of selected) {
      if (!values.some((x) => x.value === v)) values.push({ value: v, count: 0, selected: true })
    }
    values.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    out.set(t.key, values.slice(0, limit))
  }

  return out
}

export { BLANK }
