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
  const s = typeof v === 'string' ? v : String(v)
  // The split/join allocates on every cell; almost no cell actually contains a
  // non-breaking space, so check before paying for it.
  return (s.includes(NBSP) ? s.split(NBSP).join(' ') : s).trim()
}

/** Is this cell non-empty? Cheaper than coercing it to a string just to test. */
function isFilled(cell: XLSX.CellObject | undefined): boolean {
  if (cell == null) return false
  const v = cell.v
  if (v == null) return false
  return typeof v !== 'string' || v.trim() !== ''
}

/** Deterministic FNV-1a style hash; same string always yields the same id. */
export function hashKey(s: string): string {
  const [h1, h2] = hashFold([0x811c9dc5, 0x01000193], s)
  return hashFinish([h1, h2])
}

export type HashState = [number, number]

/**
 * Fold one more string into a running hash. Lets the report fingerprint be
 * accumulated row by row instead of concatenating 91k row ids into a multi-MB
 * string purely to hash it once.
 */
export function hashFold(state: HashState, s: string): HashState {
  let [h1, h2] = state
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x85ebca6b)
  }
  return [h1, h2]
}

export function hashFinish(state: HashState): string {
  return (state[0] >>> 0).toString(36) + (state[1] >>> 0).toString(36)
}

const FOOTER_LABELS = new Set(['total', 'totals', 'grand total', 'applied filters', 'sum'])

/** How many leading rows we look at to locate the header row. */
const PROBE_ROWS = 25

/** Pick the row that maps to the most canonical headers within the probe window. */
function findHeaderRow(matrix: unknown[][]): number {
  let best = 0
  let bestScore = -1
  const limit = Math.min(matrix.length, PROBE_ROWS)
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

/**
 * Image tags from this pipeline are structured, and the structure is more
 * filterable than the whole string. Across a real export, 321 of 333 distinct
 * tags carry a leading build number and a trailing build timestamp:
 *
 *   246-MYEXP-PHASE1-SIT-20260917-1-2026-09-17-11-40
 *   |   |                           `- built at
 *   |   `- stream (the dated run counter is stripped)
 *   `- build number
 *
 *   9-develop-1.0.0-2026-07-15-09-27   -> stream "develop", version "1.0.0"
 *
 * Anything that does not match (`latest`, `curl`, `alpine`) keeps the whole tag
 * as its stream rather than being discarded.
 */
export interface TagParts {
  stream: string
  version: string
  build: number | undefined
  builtAt: string | undefined
}

const TAG_BUILD = /^(\d+)-(.*)$/
const TAG_TIMESTAMP = /^(.*)-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/
const TAG_VERSION = /-(\d+\.\d+(?:\.\d+)?[\w.-]*)$/
/** The `-20260917-1` run counter inside the SIT pipeline's tags. */
const TAG_RUN = /^(.*)-(\d{8})-(\d+)$/

export function parseTag(raw: string): TagParts {
  const tag = raw.trim()
  if (!tag) return { stream: '', version: '', build: undefined, builtAt: undefined }

  let rest = tag
  let build: number | undefined
  const b = TAG_BUILD.exec(rest)
  if (b) {
    build = Number(b[1])
    rest = b[2]
  }

  let builtAt: string | undefined
  const ts = TAG_TIMESTAMP.exec(rest)
  if (ts) {
    const t = Date.UTC(Number(ts[2]), Number(ts[3]) - 1, Number(ts[4]), Number(ts[5]), Number(ts[6]))
    if (!Number.isNaN(t)) {
      builtAt = new Date(t).toISOString()
      rest = ts[1]
    }
  }

  let version = ''
  const v = TAG_VERSION.exec(rest)
  if (v) {
    version = v[1]
    rest = rest.slice(0, rest.length - v[0].length)
  }

  const run = TAG_RUN.exec(rest)
  if (run) rest = run[1]

  return { stream: rest || tag, version, build, builtAt }
}

/** How long ago the image itself was built - distinct from finding age. */
export const IMAGE_AGE_ORDER = ['0-7d', '8-30d', '31-90d', '91-180d', '180d+', 'Unknown']

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
 * Read the workbook.
 *
 * `cellDates:false` keeps date cells as Excel serials so we decode them in UTC
 * ourselves - letting SheetJS build Date objects would bake the *reader's*
 * timezone into the result, and the same file would parse differently in Kuala
 * Lumpur and in Prague.
 *
 * `dense:true` stores cells as a `[row][col]` array rather than one map keyed by
 * A1 address. On a real 91k-row x 56-col export that is 5.1M keys the engine no
 * longer has to hash and retain: measured at 14.3s/860MB -> 8.4s/600MB.
 */
export function readWorkbook(data: ArrayBuffer, opts?: XLSX.ParsingOptions): XLSX.WorkBook {
  return XLSX.read(data, { cellDates: false, dense: true, ...opts })
}

/**
 * Read only the first `n` rows of every sheet - enough for `inspectWorkbook` to
 * summarise them, and roughly six times cheaper than a full read, so the sheet
 * picker appears quickly instead of after the whole workbook is materialised.
 */
export function readWorkbookForPicker(data: ArrayBuffer, n = PROBE_ROWS): XLSX.WorkBook {
  return readWorkbook(data, { sheetRows: n })
}

/**
 * Read one named sheet and skip the rest. On a workbook whose other tabs are
 * large this avoids materialising them; on this export's layout (a small pivot
 * tab beside the data) it changes little, but it also keeps peak memory to a
 * single sheet.
 */
export function readWorkbookSheet(data: ArrayBuffer, sheetName: string): XLSX.WorkBook {
  return readWorkbook(data, { sheets: [sheetName] })
}

/** Cell grid of a dense sheet: `[row][col]`, absolute from row 0, holes allowed. */
type DenseGrid = (XLSX.CellObject | undefined)[][]

function gridOf(sheet: XLSX.WorkSheet): DenseGrid {
  return ((sheet as unknown as Record<string, unknown>)['!data'] as DenseGrid | undefined) ?? []
}

/** Raw cell value, or null when the cell is absent. */
function cellValue(cell: XLSX.CellObject | undefined): unknown {
  return cell == null ? null : (cell.v ?? null)
}

/** Read one row's values out of a dense grid. */
function rawRow(grid: DenseGrid, r: number, maxCol: number): unknown[] {
  const cells = grid[r]
  const row: unknown[] = new Array(maxCol + 1)
  for (let c = 0; c <= maxCol; c++) row[c] = cellValue(cells?.[c])
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
    // Under `sheetRows` the reader truncates `!ref` to the rows it kept and
    // records the sheet's true extent in `!fullref`. Reporting the truncated
    // range would tell the picker every sheet has ~25 rows, which is exactly
    // the signal the picker exists to show.
    const props = sheet as unknown as Record<string, string | undefined>
    const ref = props?.['!fullref'] ?? sheet?.['!ref']
    if (!sheet || !ref) {
      return {
        name, rowCount: 0, columnCount: 0, headerRowIndex: 0,
        mappedColumns: 0, dataRowEstimate: 0, looksLikeReport: false,
      }
    }
    const range = XLSX.utils.decode_range(ref)
    const rowCount = range.e.r - range.s.r + 1
    const columnCount = range.e.c - range.s.c + 1
    const grid = gridOf(sheet)

    const probe: unknown[][] = []
    const available = Math.min(range.e.r, grid.length - 1)
    const limit = Math.min(available, range.s.r + PROBE_ROWS - 1)
    for (let r = range.s.r; r <= limit; r++) probe.push(rawRow(grid, r, range.e.c))

    const headerRowIndex = findHeaderRow(probe) + range.s.r
    const headerRow = (probe[headerRowIndex - range.s.r] ?? []).map(coerceString)
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
  opts?: {
    sheetName?: string
    now?: Date
    sheetChoice?: SheetChoice
    /** Called every few thousand rows so a worker can report progress. */
    onProgress?: (done: number, total: number) => void
  },
): ParseResult {
  const sheetNames = wb.SheetNames
  const sheetName = opts?.sheetName && sheetNames.includes(opts.sheetName) ? opts.sheetName : sheetNames[0]
  const sheet = wb.Sheets[sheetName]
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in ${fileName}`)

  // Walk the dense grid directly. `sheet_to_json` would build a second full
  // copy of the sheet (measured at 2.2s / 91k rows) purely to be iterated once.
  const grid = gridOf(sheet)
  const ref = sheet['!ref']
  const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: grid.length - 1, c: 0 } }
  const maxCol = range.e.c
  const lastRow = Math.max(range.e.r, grid.length - 1)

  const probe: unknown[][] = []
  for (let r = range.s.r; r <= Math.min(lastRow, range.s.r + PROBE_ROWS - 1); r++) {
    probe.push(rawRow(grid, r, maxCol))
  }
  const headerRowIndex = findHeaderRow(probe) + range.s.r
  const headerRow = rawRow(grid, headerRowIndex, maxCol).map(coerceString)

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
  let fp: HashState = [0x811c9dc5, 0x01000193]
  let skippedRows = 0
  let reportedTotal: number | undefined
  let appliedFilters: string | undefined
  const countCol = [...colToKey.entries()].find(([, k]) => k === 'count')?.[0]

  // Pre-resolve the column -> (key, kind) work so the hot loop does no Map
  // lookups per cell.
  const plan = [...colToKey.entries()].map(([col, key]) => ({ col, key, kind: kindByKey.get(key) }))
  const extraPlan = [...extraCols.entries()]

  const onProgress = opts?.onProgress
  const totalRows = Math.max(1, lastRow - headerRowIndex)
  const PROGRESS_EVERY = 5000

  for (let r = headerRowIndex + 1; r <= lastRow; r++) {
    if (onProgress && (r - headerRowIndex) % PROGRESS_EVERY === 0) {
      onProgress(r - headerRowIndex, totalRows)
    }
    const cells = grid[r]
    if (!cells) continue

    let filled = 0
    for (let i = 0; i < mappedCols.length; i++) if (isFilled(cells[mappedCols[i]])) filled++

    if (filled < minFilled) {
      // Footer rows land here. Only now is it worth materialising strings.
      let firstValue = ''
      for (let c = 0; c <= maxCol; c++) {
        if (isFilled(cells[c])) {
          firstValue = coerceString(cells[c]!.v)
          break
        }
      }
      if (firstValue !== '') {
        skippedRows++
        const firstLabel = normaliseHeader(firstValue)
        if (FOOTER_LABELS.has(firstLabel) && countCol != null) {
          reportedTotal = coerceNumber(cellValue(cells[countCol])) ?? reportedTotal
        }
        if (firstLabel.startsWith('applied filters')) {
          const block = rawRow(grid, r, maxCol).map(coerceString).filter(Boolean).join('\n')
          appliedFilters = block.replace(/^applied filters:?\s*/i, '').trim() || block
        }
      }
      continue
    }

    const rec: Record<string, unknown> = {}
    for (let i = 0; i < plan.length; i++) {
      const { col, key, kind } = plan[i]
      const v = cellValue(cells[col])
      if (kind === 'date') rec[key] = coerceDate(v)
      else if (kind === 'number') rec[key] = coerceNumber(v)
      else rec[key] = coerceString(v)
    }
    for (let i = 0; i < extraPlan.length; i++) {
      rec[extraPlan[i][1]] = coerceString(cellValue(cells[extraPlan[i][0]]))
    }

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

    const tagParts = parseTag(coerceString(rec.tag))
    rec.tagStream = tagParts.stream
    rec.tagVersion = tagParts.version
    rec.tagBuild = tagParts.build
    rec.tagBuiltAt = tagParts.builtAt
    const imageAgeDays = tagParts.builtAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(tagParts.builtAt)) / MS_PER_DAY))
      : undefined
    rec.imageAgeDays = imageAgeDays
    rec.imageAgeBucket = ageBucketOf(imageAgeDays)

    // Identity: what makes this finding *this* finding. Row index is the last
    // resort so genuinely duplicated lines still get distinct, stable ids.
    const identity = [
      rec.cve, rec.bulletin, rec.imageId, rec.digestId, rec.repo, rec.tag,
      rec.namespace, rec.cluster, rec.hostName, rec.packageName, rec.packageVersion, rec.packagePath,
    ].map((v) => coerceString(v)).join(SEP)
    const id = `${hashKey(identity)}-${r}`
    rec.id = id
    rec.rowIndex = r + 1
    fp = hashFold(fp, id)
    fp = hashFold(fp, ',')

    rows.push(rec as Finding)
  }

  const findingCount = rows.reduce((a, r) => a + ((r.count as number) || 1), 0)
  const presentKeys = FIELDS.map((f) => f.key).filter((k) => usedKeys.has(k))
  // Folded incrementally above; the preamble is mixed in last so a change to
  // the sheet, headers or row count still moves the fingerprint.
  fp = hashFold(fp, `${SEP2}${sheetName}${SEP2}${headerRow.join('|')}${SEP2}${rows.length}${SEP2}${findingCount}`)
  const fingerprint = hashFinish(fp)

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
