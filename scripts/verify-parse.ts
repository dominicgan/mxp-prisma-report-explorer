/**
 * Parser smoke test.
 *
 * Run against any export to confirm the explorer will read it correctly, and to
 * prove the parse is deterministic: parsing the same bytes twice must produce
 * the same fingerprint and the same row ids.
 *
 *   npm run verify -- public/samples/prisma-sample-dump.xlsx
 */
import fs from 'node:fs'
import path from 'node:path'
import { FIELDS } from '../src/lib/schema'
import { bestSheet, inspectWorkbook, parseSheet, readWorkbook } from '../src/lib/parse'

const args = process.argv.slice(2)
const sheetArg = (() => {
  const i = args.indexOf('--sheet')
  return i !== -1 ? args[i + 1] : undefined
})()
const file = args.find((a) => !a.startsWith('--') && a !== sheetArg) ?? 'public/samples/prisma-sample-dump.xlsx'
const abs = path.resolve(file)
if (!fs.existsSync(abs)) {
  console.error(`No such file: ${abs}`)
  process.exit(1)
}

const buf = fs.readFileSync(abs)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer

// Pin `now` so age-derived fields are stable across runs of this check.
const now = new Date('2026-09-28T00:00:00Z')
const wb = readWorkbook(ab)
const sheets = inspectWorkbook(wb)

if (sheets.length > 1) {
  console.log(`sheets          ${sheets.length} in this workbook`)
  for (const s of sheets) {
    const mark = s.looksLikeReport ? '*' : ' '
    console.log(
      `  ${mark} ${s.name.padEnd(24)} ~${String(s.dataRowEstimate).padStart(6)} rows  ` +
        `${String(s.columnCount).padStart(3)} cols  ${String(s.mappedColumns).padStart(3)} recognised`,
    )
  }
  console.log('')
}

// Same selection the app makes: an explicit --sheet wins, else the best-looking one.
const sheetName = sheetArg ?? bestSheet(sheets)
const a = parseSheet(wb, path.basename(abs), { now, sheetName })
const b = parseSheet(wb, path.basename(abs), { now, sheetName })

const { meta, rows } = a
const fail: string[] = []

console.log(`file            ${meta.fileName}`)
console.log(`sheet           ${meta.sheetName}  (of ${meta.sheetNames.join(', ')})`)
console.log(`header row      ${meta.headerRowIndex + 1}`)
console.log(`data rows       ${meta.rowCount}`)
console.log(`finding count   ${meta.findingCount}`)
console.log(`reported total  ${meta.reportedTotal ?? '-'}`)
console.log(`skipped rows    ${meta.skippedRows}  (footers / blanks)`)
console.log(`mapped fields   ${meta.presentKeys.length} / ${FIELDS.length}`)
console.log(`unmapped        ${meta.unmappedHeaders.length ? meta.unmappedHeaders.join(', ') : 'none'}`)
console.log(`fingerprint     ${meta.fingerprint}`)

const missing = FIELDS.filter((f) => !meta.presentKeys.includes(f.key)).map((f) => f.label)
if (missing.length) console.log(`absent columns  ${missing.join(', ')}`)

if (meta.appliedFilters) console.log(`\napplied filters:\n${meta.appliedFilters.split('\n').map((l) => `  ${l}`).join('\n')}`)

const tally = (key: string) =>
  rows.reduce<Record<string, number>>((m, r) => {
    const k = String(r[key] ?? 'Unknown')
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})

console.log('\nseverity   ', tally('severity'))
console.log('surface    ', tally('surface'))
console.log('triage     ', tally('triage'))
console.log('environment', tally('environment'))
console.log('repos      ', new Set(rows.map((r) => r.repo)).size)
console.log('CVEs       ', new Set(rows.map((r) => r.cve).filter(Boolean)).size)

if (rows.length) {
  console.log('\nsample row:')
  const r0 = rows[0]
  for (const k of ['id', 'cve', 'severity', 'cvss', 'repo', 'tag', 'namespace', 'environment',
    'exploitable', 'patchable', 'triage', 'surface', 'surfaceReason', 'packageName',
    'packageVersion', 'packageType', 'discovered', 'fixDate', 'ageDays', 'count']) {
    console.log(`  ${k.padEnd(15)} ${String(r0[k] ?? '')}`)
  }
}

// --- assertions ----------------------------------------------------------
if (a.meta.fingerprint !== b.meta.fingerprint) fail.push('fingerprint is not stable across two parses')
if (rows.length === 0) fail.push('no data rows parsed')
const ids = new Set(rows.map((r) => r.id))
if (ids.size !== rows.length) fail.push(`row ids collide: ${ids.size} unique for ${rows.length} rows`)
const badDates = rows.filter((r) => r.discovered != null && Number.isNaN(Date.parse(String(r.discovered))))
if (badDates.length) fail.push(`${badDates.length} rows have an unparseable Discovered date`)

console.log('')
if (fail.length) {
  for (const f of fail) console.error(`FAIL  ${f}`)
  process.exit(1)
}
console.log('PASS  parse is deterministic and well-formed')
