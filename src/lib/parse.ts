import * as XLSX from 'xlsx'
import { FIELDS, normaliseHeader, normaliseSeverity, resolveHeader, type Surface } from './schema'

export interface Finding {
  id: string
  rowIndex: number
  [key: string]: unknown
}

export interface ReportMeta {
  fileName: string
  sheetName: string
  sheetNames: string[]
  headerRowIndex: number
  /** Canonical keys actually present in this file. */
  presentKeys: string[]
  /** Headers we could not map to the canonical schema (kept as extra columns). */
  unmappedHeaders: string[]
  rowCount: number
  /** Sum of the `#` column when present, else rowCount. */
  findingCount: number
  /** Grand total from the export's own `Total` footer row, if present. */
  reportedTotal?: number
  /** The `Applied filters:` provenance block Prisma appends under the data. */
  appliedFilters?: string
  skippedRows: number
  /** How this sheet came to be the one parsed. */
  sheetChoice: SheetChoice
  parsedAt: string
  /** Stable fingerprint of the parsed content - equal inputs give equal output. */
  fingerprint: string
}

export interface ParseResult {
  rows: Finding[]
  meta: ReportMeta
}

/** Why a given sheet was the one parsed - surfaced in the UI so it is never a mystery. */
export type SheetChoice = 'only-sheet' | 'remembered' | 'chosen' | 'auto'

/** Cheap per-sheet summary, used to populate the sheet picker. */
export interface SheetInfo {
  name: string
  /** Rows and columns according to the sheet's own declared range. */
  rowCount: number
  columnCount: number
  headerRowIndex: number
  /** Headers on that row that resolve to a canonical field. */
  mappedColumns: number
  /** Approximate data rows: everything below the header row. */
  dataRowEstimate: number
  /** True when this looks like an actual Prisma export rather than a notes tab. */
  looksLikeReport: boolean
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

const SEP = String.fromCharCode(1)
const SEP2 = String.fromCharCode(2)
const NBSP = String.fromCharCode(160)

/** Excel serial -> ISO date string (UTC), guarding against out-of-range values. */
function serialToISO(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return undefined
  return new Date(EXCEL_EPOCH_UTC + Math.round(serial * MS_PER_DAY)).toISOString()
}

/**
 * Dates arrive three ways in these exports: real Date objects (cellDates),
 * Excel serials, and plain `YYYY-MM-DD` strings. Normalise all to ISO.
 */
export function coerceDate(v: unknown): string | undefined {
  if (v == null || v === '') return undefined
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString()
  if (typeof v === 'number') return serialToISO(v)
  const s = String(v).trim()
  if (!s) return undefined
  if (/^\d+(\.\d+)?$/.test(s)) return serialToISO(Number(s))
  const t = Date.parse(s.includes('T') || s.includes(' ') ? s : `${s}T00:00:00Z`)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

export function coerceNumber(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

function coerceString(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v).split(NBSP).join(' ').trim()
}

/** Deterministic FNV-1a style hash; same string always yields the same id. */
export function hashKey(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x85ebca6b)
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)
}

const FOOTER_LABELS = new Set(['total', 'totals', 'grand total', 'applied filters', 'sum'])

/** Pick the row that maps to the most canonical headers within the first 25 rows. */
function findHeaderRow(matrix: unknown[][]): number {
  let best = 0
  let bestScore = -1
  const limit = Math.min(matrix.length, 25)
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] ?? []
    let score = 0
    for (const cell of row) if (resolveHeader(coerceString(cell))) score++
    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }
  return bestScore > 0 ? best : 0
}

/** Package types that live in the OS/image layer rather than in application code. */
const OS_PACKAGE_TYPES = new Set(['deb', 'rpm', 'apk', 'os', 'distro', 'binary', 'unknown-os'])
const CODE_PACKAGE_TYPES = new Set([
  'jar', 'java', 'maven', 'gradle', 'npm', 'nodejs', 'node', 'yarn', 'python', 'pypi', 'pip',
  'gem', 'ruby', 'go', 'golang', 'nuget', 'dotnet', 'composer', 'php', 'cargo', 'rust', 'package',
])

/**
 * Classify a finding as a container/OS-image problem or an application-code problem.
 *
 * Tiered and deterministic, so the same row always classifies the same way:
 *   1. package type is decisive when it names a known ecosystem
 *   2. otherwise fall back to Prisma's own vulnerability category
 *   3. otherwise infer from the PURL scheme
 */
export function classifySurface(row: Record<string, unknown>): { surface: Surface; reason: string } {
  const pt = coerceString(row.packageType).toLowerCase()
  if (pt && OS_PACKAGE_TYPES.has(pt)) return { surface: 'Container', reason: `package type "${pt}" is an OS/image package` }
  if (pt && CODE_PACKAGE_TYPES.has(pt)) return { surface: 'Code', reason: `package type "${pt}" is an application dependency` }

  const cat = coerceString(row.vulnerabilityCategory).toLowerCase()
  if (cat) {
    if (/^(os|image|container|distro)/.test(cat)) return { surface: 'Container', reason: `vulnerability category "${cat}"` }
    if (/^(app|code|language|library|package)/.test(cat)) return { surface: 'Code', reason: `vulnerability category "${cat}"` }
  }

  const purl = coerceString(row.purl).toLowerCase()
  const scheme = /^pkg:([a-z0-9.+-]+)\//.exec(purl)?.[1]
  if (scheme) {
    if (OS_PACKAGE_TYPES.has(scheme)) return { surface: 'Container', reason: `PURL scheme "pkg:${scheme}"` }
    if (CODE_PACKAGE_TYPES.has(scheme)) return { surface: 'Code', reason: `PURL scheme "pkg:${scheme}"` }
  }

  if (coerceString(row.distro)) return { surface: 'Container', reason: 'distro present, no package ecosystem' }
  return { surface: 'Unknown', reason: 'no package type, category or PURL to classify on' }
}

/** "Non-Exploitable" / "Yes" / "" -> a strict tri-state. */
export function triState(v: unknown, positive: RegExp, negative: RegExp): 'Yes' | 'No' | 'Unknown' {
  const s = coerceString(v).toLowerCase()
  if (!s) return 'Unknown'
  if (negative.test(s)) return 'No'
  if (positive.test(s)) return 'Yes'
  return 'Unknown'
}

const EXPLOIT_NEG = /^(non[- ]?exploitable|not exploitable|no|false|n)$/
const EXPLOIT_POS = /^(exploitable|yes|true|y)$/
const PATCH_NEG = /^(non[- ]?patchable|not patchable|unpatchable|no|false|n)$/
const PATCH_POS = /^(patchable|yes|true|y)$/

export type Triage =
  | 'Exploitable & Patchable'
  | 'Exploitable, No Patch'
  | 'Not Exploitable, Patchable'
  | 'Not Exploitable, No Patch'
  | 'Unclassified'

export const TRIAGE_ORDER: Triage[] = [
  'Exploitable & Patchable',
  'Exploitable, No Patch',
  'Not Exploitable, Patchable',
  'Not Exploitable, No Patch',
  'Unclassified',
]

export function triageClass(exploitable: string, patchable: string): Triage {
  if (exploitable === 'Unknown' || patchable === 'Unknown') return 'Unclassified'
  if (exploitable === 'Yes') return patchable === 'Yes' ? 'Exploitable & Patchable' : 'Exploitable, No Patch'
  return patchable === 'Yes' ? 'Not Exploitable, Patchable' : 'Not Exploitable, No Patch'
}

export const AGE_BUCKET_ORDER = ['0-7d', '8-30d', '31-90d', '91-180d', '180d+', 'Unknown']

export function ageBucketOf(days: number | undefined): string {
  if (days == null) return 'Unknown'
  if (days <= 7) return '0-7d'
  if (days <= 30) return '8-30d'
  if (days <= 90) return '31-90d'
  if (days <= 180) return '91-180d'
  return '180d+'
}

/**
 * Read the workbook once. `cellDates:false` keeps date cells as Excel serials
 * so we decode them in UTC ourselves - letting SheetJS build Date objects would
 * bake the *reader's* timezone into the result, and the same file would parse
 * differently in Kuala Lumpur and in Prague.
 */
export function readWorkbook(data: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(data, { cellDates: false })
}

/** Read a single row straight out of the sheet, without materialising the rest. */
function rawRow(sheet: XLSX.WorkSheet, r: number, maxCol: number): unknown[] {
  const row: unknown[] = []
  for (let c = 0; c <= maxCol; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined
    row.push(cell?.v ?? null)
  }
  return row
}

/**
 * Summarise every sheet without parsing any of them in full.
 *
 * A workbook can carry a 10k-row export plus a handful of notes and pivot tabs;
 * this only touches each sheet's declared range and its first 25 rows, so the
 * picker opens instantly even on a large file.
 */
export function inspectWorkbook(wb: XLSX.WorkBook): SheetInfo[] {
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name]
    const ref = sheet?.['!ref']
    if (!sheet || !ref) {
      return {
        name, rowCount: 0, columnCount: 0, headerRowIndex: 0,
        mappedColumns: 0, dataRowEstimate: 0, looksLikeReport: false,
      }
    }
    const range = XLSX.utils.decode_range(ref)
    const rowCount = range.e.r - range.s.r + 1
    const columnCount = range.e.c - range.s.c + 1

    const probe: unknown[][] = []
    const limit = Math.min(range.e.r, range.s.r + 24)
    for (let r = range.s.r; r <= limit; r++) probe.push(rawRow(sheet, r, range.e.c))

    const headerRowIndex = findHeaderRow(probe)
    const headerRow = (probe[headerRowIndex] ?? []).map(coerceString)
    const seen = new Set<string>()
    for (const h of headerRow) {
      const key = h && resolveHeader(h)
      if (key) seen.add(key)
    }
    const mappedColumns = seen.size
    const dataRowEstimate = Math.max(0, rowCount - (headerRowIndex - range.s.r) - 1)

    return {
      name,
      rowCount,
      columnCount,
      headerRowIndex,
      mappedColumns,
      dataRowEstimate,
      // Five recognised columns and at least one row under them: enough to be a
      // report rather than a notes tab, without demanding a full column set.
      looksLikeReport: mappedColumns >= 5 && dataRowEstimate > 0,
    }
  })
}

/** The sheet to default to when there is no remembered choice: the best-looking one. */
export function bestSheet(sheets: SheetInfo[]): string | undefined {
  const ranked = [...sheets].sort(
    (a, b) => b.mappedColumns - a.mappedColumns || b.dataRowEstimate - a.dataRowEstimate,
  )
  return ranked.find((s) => s.looksLikeReport)?.name ?? ranked[0]?.name
}

export function parseSheet(
  wb: XLSX.WorkBook,
  fileName: string,
  opts?: { sheetName?: string; now?: Date; sheetChoice?: SheetChoice },
): ParseResult {
  const sheetNames = wb.SheetNames
  const sheetName = opts?.sheetName && sheetNames.includes(opts.sheetName) ? opts.sheetName : sheetNames[0]
  const sheet = wb.Sheets[sheetName]
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in ${fileName}`)

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true })
  const headerRowIndex = findHeaderRow(matrix)
  const headerRow = (matrix[headerRowIndex] ?? []).map(coerceString)

  const colToKey = new Map<number, string>()
  const unmappedHeaders: string[] = []
  const extraCols = new Map<number, string>()
  const usedKeys = new Set<string>()
  headerRow.forEach((h, i) => {
    if (!h) return
    const key = resolveHeader(h)
    if (key && !usedKeys.has(key)) {
      colToKey.set(i, key)
      usedKeys.add(key)
    } else if (!key) {
      unmappedHeaders.push(h)
      extraCols.set(i, `extra:${normaliseHeader(h)}`)
    }
  })

  const kindByKey = new Map(FIELDS.map((f) => [f.key, f.kind]))
  const mappedCols = [...colToKey.keys()]
  // A data row must fill a meaningful share of the mapped columns; the Total
  // and "Applied filters:" footers fill one or two and are dropped here.
  const minFilled = Math.max(3, Math.ceil(mappedCols.length * 0.2))

  const now = opts?.now ?? new Date()
  const rows: Finding[] = []
  let skippedRows = 0
  let reportedTotal: number | undefined
  let appliedFilters: string | undefined
  const countCol = [...colToKey.entries()].find(([, k]) => k === 'count')?.[0]

  for (let r = headerRowIndex + 1; r < matrix.length; r++) {
    const raw = matrix[r] ?? []
    const firstValue = coerceString(raw.find((c) => coerceString(c) !== ''))

    let filled = 0
    for (const c of mappedCols) if (coerceString(raw[c]) !== '') filled++

    if (filled < minFilled) {
      if (firstValue !== '') {
        skippedRows++
        const firstLabel = normaliseHeader(firstValue)
        if (FOOTER_LABELS.has(firstLabel) && countCol != null) {
          reportedTotal = coerceNumber(raw[countCol]) ?? reportedTotal
        }
        if (firstLabel.startsWith('applied filters')) {
          const block = raw.map(coerceString).filter(Boolean).join('\n')
          appliedFilters = block.replace(/^applied filters:?\s*/i, '').trim() || block
        }
      }
      continue
    }

    const rec: Record<string, unknown> = {}
    for (const [col, key] of colToKey) {
      const v = raw[col]
      const kind = kindByKey.get(key)
      if (kind === 'date') rec[key] = coerceDate(v)
      else if (kind === 'number') rec[key] = coerceNumber(v)
      else rec[key] = coerceString(v)
    }
    for (const [col, key] of extraCols) rec[key] = coerceString(raw[col])

    rec.severity = normaliseSeverity(rec.severity as string)
    rec.cve = coerceString(rec.cve).toUpperCase()
    rec.count = (rec.count as number | undefined) ?? 1

    const { surface, reason } = classifySurface(rec)
    rec.surface = surface
    rec.surfaceReason = reason
    rec.exploitable = triState(rec.isExploitable, EXPLOIT_POS, EXPLOIT_NEG)
    rec.patchable = triState(rec.isPatchable, PATCH_POS, PATCH_NEG)
    rec.triage = triageClass(rec.exploitable as string, rec.patchable as string)

    const disc = rec.discovered as string | undefined
    const ageDays = disc ? Math.max(0, Math.floor((now.getTime() - Date.parse(disc)) / MS_PER_DAY)) : undefined
    rec.ageDays = ageDays
    rec.ageBucket = ageBucketOf(ageDays)

    // Identity: what makes this finding *this* finding. Row index is the last
    // resort so genuinely duplicated lines still get distinct, stable ids.
    const identity = [
      rec.cve, rec.bulletin, rec.imageId, rec.digestId, rec.repo, rec.tag,
      rec.namespace, rec.cluster, rec.hostName, rec.packageName, rec.packageVersion, rec.packagePath,
    ].map((v) => coerceString(v)).join(SEP)
    rec.id = `${hashKey(identity)}-${r}`
    rec.rowIndex = r + 1

    rows.push(rec as Finding)
  }

  const findingCount = rows.reduce((a, r) => a + ((r.count as number) || 1), 0)
  const presentKeys = FIELDS.map((f) => f.key).filter((k) => usedKeys.has(k))
  const fingerprint = hashKey(
    [sheetName, headerRow.join('|'), rows.length, findingCount, rows.map((r) => r.id).join(',')].join(SEP2),
  )

  return {
    rows,
    meta: {
      fileName,
      sheetName,
      sheetNames,
      headerRowIndex,
      presentKeys,
      unmappedHeaders,
      rowCount: rows.length,
      findingCount,
      reportedTotal,
      appliedFilters,
      skippedRows,
      sheetChoice: opts?.sheetChoice ?? 'auto',
      parsedAt: now.toISOString(),
      fingerprint,
    },
  }
}

/** Convenience wrapper: read and parse in one call. */
export function parseWorkbook(
  data: ArrayBuffer,
  fileName: string,
  opts?: { sheetName?: string; now?: Date; sheetChoice?: SheetChoice },
): ParseResult {
  return parseSheet(readWorkbook(data), fileName, opts)
}
