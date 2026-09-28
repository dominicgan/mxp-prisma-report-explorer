import { AGE_BUCKET_ORDER, TRIAGE_ORDER, type Finding } from './parse'
import { SEVERITY_ORDER, severityRank } from './schema'

export interface Bucket {
  key: string
  count: number
}

/** Count rows by a field, in a caller-supplied order where one exists. */
export function countBy(rows: Finding[], key: string, order?: readonly string[]): Bucket[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const raw = r[key]
    const k = raw == null || raw === '' ? 'Unknown' : String(raw)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  const entries = [...m.entries()].map(([key, count]) => ({ key, count }))
  if (order) {
    const idx = new Map(order.map((o, i) => [o, i]))
    return entries.sort(
      (a, b) => (idx.get(a.key) ?? 999) - (idx.get(b.key) ?? 999) || a.key.localeCompare(b.key),
    )
  }
  return entries.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export function severityBreakdown(rows: Finding[]): Bucket[] {
  return countBy(rows, 'severity', SEVERITY_ORDER)
}

export function triageBreakdown(rows: Finding[]): Bucket[] {
  return countBy(rows, 'triage', TRIAGE_ORDER)
}

export function ageBreakdown(rows: Finding[]): Bucket[] {
  return countBy(rows, 'ageBucket', AGE_BUCKET_ORDER)
}

/** Rows grouped by `key`, each with a severity split - for stacked bars. */
export interface StackedRow {
  key: string
  total: number
  Critical: number
  High: number
  Medium: number
  Low: number
  Unknown: number
}

export function stackedBySeverity(rows: Finding[], key: string, topN = 12): StackedRow[] {
  const m = new Map<string, StackedRow>()
  for (const r of rows) {
    const raw = r[key]
    const k = raw == null || raw === '' ? 'Unknown' : String(raw)
    let e = m.get(k)
    if (!e) {
      e = { key: k, total: 0, Critical: 0, High: 0, Medium: 0, Low: 0, Unknown: 0 }
      m.set(k, e)
    }
    const sev = String(r.severity ?? 'Unknown') as keyof StackedRow
    if (sev in e && sev !== 'key' && sev !== 'total') (e[sev] as number)++
    e.total++
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, topN)
}

/** The 2x2 that drives triage: exploitable on one axis, patchable on the other. */
export interface Matrix2x2 {
  cells: { exploitable: string; patchable: string; count: number }[]
  axes: { exploitable: string[]; patchable: string[] }
}

export function exploitPatchMatrix(rows: Finding[]): Matrix2x2 {
  const order = ['Yes', 'No', 'Unknown']
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.exploitable}|${r.patchable}`
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  const present = (axis: 'exploitable' | 'patchable') => {
    const seen = new Set(rows.map((r) => String(r[axis])))
    const vals = order.filter((o) => seen.has(o))
    return vals.length ? vals : ['Unknown']
  }
  const ex = present('exploitable')
  const pa = present('patchable')
  const cells = ex.flatMap((e) => pa.map((p) => ({ exploitable: e, patchable: p, count: m.get(`${e}|${p}`) ?? 0 })))
  return { cells, axes: { exploitable: ex, patchable: pa } }
}

// --- CVE rollup ----------------------------------------------------------

export interface CveRollup {
  cve: string
  severity: string
  cvss?: number
  findings: number
  repos: number
  repoList: string[]
  packages: string[]
  namespaces: number
  environments: string[]
  exploitable: boolean
  patchable: boolean
  surfaces: string[]
  oldestDiscovered?: string
  fixDate?: string
  description?: string
  status?: string
}

/** One row per CVE, with the blast radius attached. */
export function rollupByCve(rows: Finding[]): CveRollup[] {
  const m = new Map<string, Finding[]>()
  for (const r of rows) {
    const cve = String(r.cve ?? '') || String(r.bulletin ?? '') || '(no identifier)'
    const list = m.get(cve)
    if (list) list.push(r)
    else m.set(cve, [r])
  }
  const uniq = (list: Finding[], k: string) =>
    [...new Set(list.map((r) => String(r[k] ?? '')).filter(Boolean))].sort()

  return [...m.entries()]
    .map(([cve, list]) => {
      const worst = list.reduce((a, b) => (severityRank(String(a.severity)) <= severityRank(String(b.severity)) ? a : b))
      const dates = list.map((r) => r.discovered as string | undefined).filter(Boolean).sort()
      return {
        cve,
        severity: String(worst.severity ?? 'Unknown'),
        cvss: list.reduce<number | undefined>((mx, r) => {
          const c = r.cvss as number | undefined
          return c == null ? mx : mx == null ? c : Math.max(mx, c)
        }, undefined),
        findings: list.length,
        repos: new Set(list.map((r) => r.repo)).size,
        repoList: uniq(list, 'repo'),
        packages: uniq(list, 'packageName'),
        namespaces: new Set(list.map((r) => r.namespace)).size,
        environments: uniq(list, 'environment'),
        exploitable: list.some((r) => r.exploitable === 'Yes'),
        patchable: list.some((r) => r.patchable === 'Yes'),
        surfaces: uniq(list, 'surface'),
        oldestDiscovered: dates[0],
        fixDate: list.find((r) => r.fixDate)?.fixDate as string | undefined,
        description: list.find((r) => r.description)?.description as string | undefined,
        status: list.find((r) => r.status)?.status as string | undefined,
      }
    })
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.findings - a.findings ||
        a.cve.localeCompare(b.cve),
    )
}

// --- Remediation rollup --------------------------------------------------

export interface FixRollup {
  packageName: string
  packageType: string
  /** Versions currently in use that are affected. */
  versions: string[]
  fixedIn?: string
  findings: number
  repos: number
  repoList: string[]
  cves: string[]
  worstSeverity: string
  exploitable: number
  patchable: number
  surface: string
}

/**
 * "One upgrade, how many findings does it close?" - ranks package upgrades by
 * blast radius, which is the fastest route from a 10k-row export to a sprint plan.
 */
export function rollupByFix(rows: Finding[]): FixRollup[] {
  const m = new Map<string, Finding[]>()
  for (const r of rows) {
    const pkg = String(r.packageName ?? '')
    if (!pkg) continue
    const list = m.get(pkg)
    if (list) list.push(r)
    else m.set(pkg, [r])
  }
  const uniq = (list: Finding[], k: string) =>
    [...new Set(list.map((r) => String(r[k] ?? '')).filter(Boolean))].sort()

  return [...m.entries()]
    .map(([packageName, list]) => {
      const worst = list.reduce((a, b) => (severityRank(String(a.severity)) <= severityRank(String(b.severity)) ? a : b))
      return {
        packageName,
        packageType: String(list[0].packageType ?? ''),
        versions: uniq(list, 'packageVersion'),
        fixedIn: list.find((r) => r.status)?.status as string | undefined,
        findings: list.length,
        repos: new Set(list.map((r) => r.repo)).size,
        repoList: uniq(list, 'repo'),
        cves: uniq(list, 'cve'),
        worstSeverity: String(worst.severity ?? 'Unknown'),
        exploitable: list.filter((r) => r.exploitable === 'Yes').length,
        patchable: list.filter((r) => r.patchable === 'Yes').length,
        surface: String(list[0].surface ?? 'Unknown'),
      }
    })
    .sort(
      (a, b) =>
        b.findings - a.findings ||
        severityRank(a.worstSeverity) - severityRank(b.worstSeverity) ||
        a.packageName.localeCompare(b.packageName),
    )
}

// --- Headline numbers ----------------------------------------------------

export interface Kpis {
  findings: number
  critical: number
  high: number
  exploitable: number
  /** Exploitable AND patchable - the "fix these first" number. */
  actionable: number
  noPatch: number
  cves: number
  repos: number
  container: number
  code: number
  prodExternal: number
  breachedKpi: number
  oldestDays?: number
}

export function computeKpis(rows: Finding[]): Kpis {
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
  const cves = new Set<string>()
  const repos = new Set<string>()

  for (const r of rows) {
    const sev = r.severity
    if (sev === 'Critical') critical++
    else if (sev === 'High') high++

    const ex = r.exploitable === 'Yes'
    const pa = r.patchable === 'Yes'
    if (ex) exploitable++
    if (ex && pa) actionable++
    if (!pa) noPatch++

    if (r.surface === 'Container') container++
    else if (r.surface === 'Code') code++

    if (String(r.environment).toLowerCase().startsWith('prod') && String(r.facing).toLowerCase().startsWith('external')) {
      prodExternal++
    }
    // Anything that isn't explicitly "Within KPI" is treated as a breach; blank
    // KPI status is not counted either way.
    const kpi = String(r.kpiStatus ?? '').trim().toLowerCase()
    if (kpi && !kpi.startsWith('within')) breachedKpi++

    if (r.cve) cves.add(String(r.cve))
    if (r.repo) repos.add(String(r.repo))

    const d = r.ageDays as number | undefined
    if (d != null && (oldestDays == null || d > oldestDays)) oldestDays = d
  }

  return {
    findings: rows.length,
    critical,
    high,
    exploitable,
    actionable,
    noPatch,
    cves: cves.size,
    repos: repos.size,
    container,
    code,
    prodExternal,
    breachedKpi,
    oldestDays,
  }
}

/** Findings discovered per day, for the trend line. */
export function discoveryTrend(rows: Finding[]): { date: string; count: number; cumulative: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const d = r.discovered as string | undefined
    if (!d) continue
    const day = d.slice(0, 10)
    m.set(day, (m.get(day) ?? 0) + 1)
  }
  let cumulative = 0
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => {
      cumulative += count
      return { date, count, cumulative }
    })
}
