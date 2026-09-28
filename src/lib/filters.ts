import type { Finding } from './parse'

/**
 * Filter state is a plain, serialisable object: every filtered view is fully
 * described by this value, which is what makes a URL shareable and a re-upload
 * land on exactly the same view.
 */
export interface FilterState {
  /** Free-text search across searchable fields. */
  q: string
  /** key -> selected values. Empty/absent means "no constraint on this key". */
  facets: Record<string, string[]>
  /** Inclusive CVSS range; undefined ends are open. */
  cvssMin?: number
  cvssMax?: number
  /** Only rows discovered on/after (ISO date, inclusive). */
  discoveredFrom?: string
  discoveredTo?: string
  /** Only rows that carry a CVE identifier. */
  cveOnly: boolean
}

export const EMPTY_FILTERS: FilterState = { q: '', facets: {}, cveOnly: false }

/** Fields free-text search looks at. Kept small so search stays fast on 10k+ rows. */
const SEARCH_KEYS = [
  'cve', 'bulletin', 'repo', 'tag', 'packageName', 'packageVersion', 'packagePath',
  'purl', 'namespace', 'cluster', 'hostName', 'serviceName', 'description',
  'imageId', 'digestId', 'ciNumber', 'serviceOwner', 'status',
]

function buildHaystack(r: Finding): string {
  let s = ''
  for (const k of SEARCH_KEYS) {
    const v = r[k]
    if (v) s += String(v).toLowerCase() + ' '
  }
  return s
}

const haystacks = new WeakMap<Finding, string>()

function haystackOf(r: Finding): string {
  let h = haystacks.get(r)
  if (h === undefined) {
    h = buildHaystack(r)
    haystacks.set(r, h)
  }
  return h
}

export function hasActiveFilters(f: FilterState): boolean {
  return (
    f.q.trim() !== '' ||
    f.cveOnly ||
    f.cvssMin != null ||
    f.cvssMax != null ||
    f.discoveredFrom != null ||
    f.discoveredTo != null ||
    Object.values(f.facets).some((v) => v.length > 0)
  )
}

export function countActiveFilters(f: FilterState): number {
  let n = 0
  if (f.q.trim()) n++
  if (f.cveOnly) n++
  if (f.cvssMin != null || f.cvssMax != null) n++
  if (f.discoveredFrom != null || f.discoveredTo != null) n++
  for (const v of Object.values(f.facets)) if (v.length) n++
  return n
}

/** Tokenised AND search: every whitespace-separated term must appear. */
function matchesQuery(r: Finding, terms: string[]): boolean {
  if (!terms.length) return true
  const hay = haystackOf(r)
  for (const t of terms) if (!hay.includes(t)) return false
  return true
}

export function applyFilters(rows: Finding[], f: FilterState, opts?: { exclude?: string }): Finding[] {
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const facetEntries = Object.entries(f.facets).filter(
    ([k, v]) => v.length > 0 && k !== opts?.exclude,
  ) as [string, string[]][]
  const facetSets = facetEntries.map(([k, v]) => [k, new Set(v)] as const)

  const from = f.discoveredFrom ? Date.parse(`${f.discoveredFrom}T00:00:00Z`) : undefined
  const to = f.discoveredTo ? Date.parse(`${f.discoveredTo}T23:59:59.999Z`) : undefined

  return rows.filter((r) => {
    if (f.cveOnly && !r.cve) return false

    for (const [k, set] of facetSets) {
      const v = r[k]
      if (!set.has(v == null || v === '' ? '(blank)' : String(v))) return false
    }

    if (f.cvssMin != null || f.cvssMax != null) {
      const c = r.cvss as number | undefined
      if (c == null) return false
      if (f.cvssMin != null && c < f.cvssMin) return false
      if (f.cvssMax != null && c > f.cvssMax) return false
    }

    if (from != null || to != null) {
      const d = r.discovered as string | undefined
      if (!d) return false
      const t = Date.parse(d)
      if (from != null && t < from) return false
      if (to != null && t > to) return false
    }

    return matchesQuery(r, terms)
  })
}

export interface FacetValue {
  value: string
  /** Rows matching this value under every *other* active filter. */
  count: number
  selected: boolean
}

/**
 * Facet counts are computed against the rows surviving all *other* filters, so
 * selecting one value in a facet doesn't zero out its siblings - the usual
 * behaviour people expect from a faceted search.
 */
export function facetValues(rows: Finding[], f: FilterState, key: string, limit = 500): FacetValue[] {
  const base = applyFilters(rows, f, { exclude: key })
  const selected = new Set(f.facets[key] ?? [])
  const counts = new Map<string, number>()
  for (const r of base) {
    const raw = r[key]
    const v = raw == null || raw === '' ? '(blank)' : String(raw)
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  // Selected values always appear, even at count 0, so they stay un-selectable-away.
  for (const v of selected) if (!counts.has(v)) counts.set(v, 0)

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, selected: selected.has(value) }))
    .sort((a, b) => (b.count - a.count) || a.value.localeCompare(b.value))
    .slice(0, limit)
}

export function toggleFacet(f: FilterState, key: string, value: string): FilterState {
  const cur = f.facets[key] ?? []
  const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
  const facets = { ...f.facets }
  if (next.length) facets[key] = next
  else delete facets[key]
  return { ...f, facets }
}

export function setFacet(f: FilterState, key: string, values: string[]): FilterState {
  const facets = { ...f.facets }
  if (values.length) facets[key] = values
  else delete facets[key]
  return { ...f, facets }
}

export function clearFacet(f: FilterState, key: string): FilterState {
  return setFacet(f, key, [])
}

// --- URL serialisation ---------------------------------------------------
// The whole view lives in the hash, so a filtered view is a shareable link and
// survives a reload.

export function encodeFilters(f: FilterState): string {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set('q', f.q.trim())
  if (f.cveOnly) p.set('cveOnly', '1')
  if (f.cvssMin != null) p.set('cvssMin', String(f.cvssMin))
  if (f.cvssMax != null) p.set('cvssMax', String(f.cvssMax))
  if (f.discoveredFrom) p.set('from', f.discoveredFrom)
  if (f.discoveredTo) p.set('to', f.discoveredTo)
  for (const [k, v] of Object.entries(f.facets)) {
    if (v.length) p.set(`f.${k}`, v.join('~'))
  }
  return p.toString()
}

export function decodeFilters(qs: string): FilterState {
  const p = new URLSearchParams(qs)
  const facets: Record<string, string[]> = {}
  for (const [k, v] of p.entries()) {
    if (k.startsWith('f.') && v) facets[k.slice(2)] = v.split('~').filter(Boolean)
  }
  const num = (k: string) => {
    const v = p.get(k)
    if (v == null || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return {
    q: p.get('q') ?? '',
    facets,
    cveOnly: p.get('cveOnly') === '1',
    cvssMin: num('cvssMin'),
    cvssMax: num('cvssMax'),
    discoveredFrom: p.get('from') ?? undefined,
    discoveredTo: p.get('to') ?? undefined,
  }
}
