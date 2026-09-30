import { dictColumn, displayValue, numColumn, type ColumnStore, type DictColumn } from './columnar'
import { AGE_BUCKET_ORDER, TRIAGE_ORDER } from './parse'
import { SEVERITY_ORDER } from './schema'
import type { Bucket, Kpis, Matrix2x2, StackedRow } from './stats'

/**
 * Every Overview aggregation, computed from the columnar index in one pass.
 *
 * The row-object versions were eight separate scans over the filtered set,
 * each doing property reads and string comparisons: ~340ms on 86k rows, which
 * is what made clicking a facet hang. Here the same numbers come out of integer
 * histograms indexed by dictionary code.
 */

export interface OverviewStats {
  kpis: Kpis
  severity: Bucket[]
  triage: Bucket[]
  age: Bucket[]
  matrix: Matrix2x2
  surface: StackedRow[]
  repo: StackedRow[]
  /** key -> counts, for the single-measure dimension charts. */
  dimensions: Record<string, Bucket[]>
  trend: { date: string; count: number; cumulative: number }[]
}

const MS_PER_DAY = 86_400_000

/** `allowed[code] === 1` where the dictionary value satisfies `pred`. */
function dictMask(col: DictColumn | null, pred: (v: string) => boolean): Uint8Array | null {
  if (!col) return null
  const m = new Uint8Array(col.dict.length)
  for (let c = 0; c < col.dict.length; c++) if (pred(col.dict[c])) m[c] = 1
  return m
}

/** Map each dictionary code to an index in `order`, or -1. */
function orderIndex(col: DictColumn | null, order: readonly string[]): Int32Array | null {
  if (!col) return null
  const out = new Int32Array(col.dict.length).fill(-1)
  for (let c = 0; c < col.dict.length; c++) {
    const i = order.indexOf(col.dict[c])
    if (i !== -1) out[c] = i
  }
  return out
}

function bucketsFromHist(col: DictColumn | null, hist: Uint32Array | null, sortByCount: boolean): Bucket[] {
  if (!col || !hist) return []
  const out: Bucket[] = []
  for (let c = 0; c < col.dict.length; c++) {
    if (hist[c] === 0) continue
    out.push({ key: displayValue(col.dict[c]) === '(blank)' ? 'Unknown' : col.dict[c], count: hist[c] })
  }
  return sortByCount ? out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)) : out
}

/**
 * Buckets for a known value order.
 *
 * Matches `countBy(rows, key, order)`: only values that actually occur are
 * returned - never zero-count placeholders - ordered by their position in
 * `order`, with anything unrecognised sorted after and then alphabetically.
 */
function orderedBuckets(
  col: DictColumn | null,
  hist: Uint32Array | null,
  order: readonly string[],
  unknownKey: string,
): Bucket[] {
  const counts = new Map<string, number>()
  if (col && hist) {
    for (let c = 0; c < col.dict.length; c++) {
      if (hist[c] === 0) continue
      const raw = col.dict[c]
      // Blank collapses into the same bucket the row-object version uses.
      const key = raw === '' ? unknownKey : raw
      counts.set(key, (counts.get(key) ?? 0) + hist[c])
    }
  }
  const rank = new Map(order.map((o, i) => [o, i]))
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999) || a.key.localeCompare(b.key))
}

const SEV = [...SEVERITY_ORDER]
const SEV_KEYS = ['Critical', 'High', 'Medium', 'Low', 'Unknown'] as const

function emptyStacked(key: string): StackedRow {
  return { key, total: 0, Critical: 0, High: 0, Medium: 0, Low: 0, Unknown: 0 }
}

/**
 * @param idx row indices surviving the current filter, from `selectIndices`
 * @param dimensionKeys extra single-measure dimensions to tally
 */
export function overviewStats(
  store: ColumnStore,
  idx: Uint32Array,
  dimensionKeys: string[],
): OverviewStats {
  const n = idx.length

  const sevCol = dictColumn(store, 'severity')
  const exCol = dictColumn(store, 'exploitable')
  const paCol = dictColumn(store, 'patchable')
  const surfCol = dictColumn(store, 'surface')
  const repoCol = dictColumn(store, 'repo')
  const triCol = dictColumn(store, 'triage')
  const ageCol = dictColumn(store, 'ageBucket')
  const cveCol = dictColumn(store, 'cve')
  const envCol = dictColumn(store, 'environment')
  const facingCol = dictColumn(store, 'facing')
  const kpiCol = dictColumn(store, 'kpiStatus')

  const sevOrder = orderIndex(sevCol, SEV)
  const exYes = dictMask(exCol, (v) => v === 'Yes')
  const paYes = dictMask(paCol, (v) => v === 'Yes')
  const surfContainer = dictMask(surfCol, (v) => v === 'Container')
  const surfCode = dictMask(surfCol, (v) => v === 'Code')
  const envProd = dictMask(envCol, (v) => v.toLowerCase().startsWith('prod'))
  const facingExt = dictMask(facingCol, (v) => v.toLowerCase().startsWith('external'))
  // Anything explicitly not "Within KPI" counts as a breach; blank counts as
  // neither, matching the row-object implementation.
  const kpiBreach = dictMask(kpiCol, (v) => v.trim() !== '' && !v.trim().toLowerCase().startsWith('within'))

  const hist = (col: DictColumn | null) => (col ? new Uint32Array(col.dict.length) : null)
  const sevHist = hist(sevCol)
  const triHist = hist(triCol)
  const ageHist = hist(ageCol)
  const surfHist = hist(surfCol)

  // Stacked tallies: dictSize x 5 severities, flattened.
  const repoStack = repoCol ? new Uint32Array(repoCol.dict.length * 5) : null
  const surfStack = surfCol ? new Uint32Array(surfCol.dict.length * 5) : null

  const dimHists: Record<string, { col: DictColumn; hist: Uint32Array }> = {}
  for (const key of dimensionKeys) {
    const col = dictColumn(store, key)
    if (col) dimHists[key] = { col, hist: new Uint32Array(col.dict.length) }
  }

  // 3x3 exploitable x patchable, using each column's own dictionary codes.
  const exDictLen = exCol?.dict.length ?? 0
  const paDictLen = paCol?.dict.length ?? 0
  const matrixHist = new Uint32Array(Math.max(1, exDictLen * paDictLen))

  const cveSeen = cveCol ? new Uint8Array(cveCol.dict.length) : null
  const repoSeen = repoCol ? new Uint8Array(repoCol.dict.length) : null

  const ageDays = numColumn(store, 'ageDays')?.values ?? null
  const discovered = numColumn(store, 'discovered')?.values ?? null
  const dayCounts = new Map<number, number>()

  let critical = 0
  let high = 0
  let exploitable = 0
  let actionable = 0
  let noPatch = 0
  let container = 0
  let code = 0
  let prodExternal = 0
  let breachedKpi = 0
  let oldestDays: number | undefined

  for (let k = 0; k < n; k++) {
    const i = idx[k]

    let sevIdx = 4
    if (sevCol && sevHist && sevOrder) {
      const c = sevCol.codes[i]
      sevHist[c]++
      const o = sevOrder[c]
      sevIdx = o === -1 ? 4 : o
      if (sevIdx === 0) critical++
      else if (sevIdx === 1) high++
    }

    if (triCol && triHist) triHist[triCol.codes[i]]++
    if (ageCol && ageHist) ageHist[ageCol.codes[i]]++

    let ex = 0
    if (exCol) {
      const c = exCol.codes[i]
      if (exYes && exYes[c] === 1) {
        ex = 1
        exploitable++
      }
      if (paCol) matrixHist[c * paDictLen + paCol.codes[i]]++
    }
    if (paCol) {
      const c = paCol.codes[i]
      const yes = paYes ? paYes[c] === 1 : false
      if (yes && ex === 1) actionable++
      if (!yes) noPatch++
    }

    if (surfCol) {
      const c = surfCol.codes[i]
      if (surfHist) surfHist[c]++
      if (surfStack) surfStack[c * 5 + sevIdx]++
      if (surfContainer && surfContainer[c] === 1) container++
      else if (surfCode && surfCode[c] === 1) code++
    }

    if (repoCol) {
      const c = repoCol.codes[i]
      if (repoStack) repoStack[c * 5 + sevIdx]++
      if (repoSeen && repoCol.dict[c] !== '') repoSeen[c] = 1
    }

    if (envCol && facingCol && envProd && facingExt) {
      if (envProd[envCol.codes[i]] === 1 && facingExt[facingCol.codes[i]] === 1) prodExternal++
    }
    if (kpiCol && kpiBreach && kpiBreach[kpiCol.codes[i]] === 1) breachedKpi++

    if (cveCol && cveSeen) {
      const c = cveCol.codes[i]
      if (cveCol.dict[c] !== '') cveSeen[c] = 1
    }

    for (const key in dimHists) {
      const d = dimHists[key]
      d.hist[d.col.codes[i]]++
    }

    if (ageDays) {
      const d = ageDays[i]
      if (!Number.isNaN(d) && (oldestDays === undefined || d > oldestDays)) oldestDays = d
    }
    if (discovered) {
      const t = discovered[i]
      if (!Number.isNaN(t)) {
        const day = Math.floor(t / MS_PER_DAY)
        dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1)
      }
    }
  }

  const countSeen = (seen: Uint8Array | null) => {
    if (!seen) return 0
    let c = 0
    for (let i = 0; i < seen.length; i++) c += seen[i]
    return c
  }

  // --- stacked rows -------------------------------------------------------
  const toStacked = (col: DictColumn | null, flat: Uint32Array | null, topN: number): StackedRow[] => {
    if (!col || !flat) return []
    const out: StackedRow[] = []
    for (let c = 0; c < col.dict.length; c++) {
      const base = c * 5
      const total = flat[base] + flat[base + 1] + flat[base + 2] + flat[base + 3] + flat[base + 4]
      if (total === 0) continue
      const row = emptyStacked(col.dict[c] === '' ? 'Unknown' : col.dict[c])
      row.total = total
      for (let s = 0; s < 5; s++) row[SEV_KEYS[s]] = flat[base + s]
      out.push(row)
    }
    return out.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, topN)
  }

  // --- 2x2 matrix ---------------------------------------------------------
  const order = ['Yes', 'No', 'Unknown']
  const present = (col: DictColumn | null, hist: (c: number) => number): string[] => {
    if (!col) return ['Unknown']
    const seen = new Set<string>()
    for (let c = 0; c < col.dict.length; c++) if (hist(c) > 0) seen.add(col.dict[c] || 'Unknown')
    const vals = order.filter((o) => seen.has(o))
    return vals.length ? vals : ['Unknown']
  }
  const exTotals = (c: number) => {
    let t = 0
    for (let p = 0; p < paDictLen; p++) t += matrixHist[c * paDictLen + p]
    return t
  }
  const paTotals = (p: number) => {
    let t = 0
    for (let c = 0; c < exDictLen; c++) t += matrixHist[c * paDictLen + p]
    return t
  }
  const exAxis = present(exCol, exTotals)
  const paAxis = present(paCol, paTotals)
  const codeFor = (col: DictColumn | null, v: string) => (col ? col.dict.indexOf(v) : -1)
  const cells = exAxis.flatMap((e) =>
    paAxis.map((p) => {
      const ec = codeFor(exCol, e)
      const pc = codeFor(paCol, p)
      return {
        exploitable: e,
        patchable: p,
        count: ec === -1 || pc === -1 ? 0 : matrixHist[ec * paDictLen + pc],
      }
    }),
  )

  // --- trend --------------------------------------------------------------
  let cumulative = 0
  const trend = [...dayCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, count]) => {
      cumulative += count
      return { date: new Date(day * MS_PER_DAY).toISOString().slice(0, 10), count, cumulative }
    })

  const dimensions: Record<string, Bucket[]> = {}
  for (const key in dimHists) {
    dimensions[key] = bucketsFromHist(dimHists[key].col, dimHists[key].hist, true)
  }

  return {
    kpis: {
      findings: n,
      critical,
      high,
      exploitable,
      actionable,
      noPatch,
      cves: countSeen(cveSeen),
      repos: countSeen(repoSeen),
      container,
      code,
      prodExternal,
      breachedKpi,
      oldestDays,
    },
    severity: orderedBuckets(sevCol, sevHist, SEV, 'Unknown'),
    triage: orderedBuckets(triCol, triHist, TRIAGE_ORDER, 'Unclassified'),
    age: orderedBuckets(ageCol, ageHist, AGE_BUCKET_ORDER, 'Unknown'),
    matrix: { cells, axes: { exploitable: exAxis, patchable: paAxis } },
    surface: toStacked(surfCol, surfStack, 4),
    repo: toStacked(repoCol, repoStack, 12),
    dimensions,
    trend,
  }
}
