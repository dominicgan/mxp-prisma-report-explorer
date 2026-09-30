/**
 * Equivalence check for the columnar filter/stats path.
 *
 * `filters.ts` and `stats.ts` keep the straightforward row-object
 * implementations; `filters-columnar.ts` and `stats-columnar.ts` are the fast
 * ones the app actually uses. This asserts they agree, so the fast path cannot
 * quietly drift away from the readable one.
 *
 *   npm run verify:columnar                       # bundled sample
 *   npm run verify:columnar -- path/to/real.xlsx  # a real export
 */
import fs from 'node:fs'
import path from 'node:path'
import { bestSheet, inspectWorkbook, parseSheet, readWorkbook } from '../src/lib/parse'
import { buildStore, storeBytes } from '../src/lib/columnar'
import { facetCounts, selectIndices, selectRows } from '../src/lib/filters-columnar'
import { applyFilters, facetValuesMany, EMPTY_FILTERS, type FilterState } from '../src/lib/filters'
import {
  ageBreakdown, computeKpis, countBy, discoveryTrend, exploitPatchMatrix,
  severityBreakdown, stackedBySeverity, triageBreakdown,
} from '../src/lib/stats'
import { overviewStats } from '../src/lib/stats-columnar'

const file = process.argv[2] ?? 'public/samples/prisma-sample-dump.xlsx'
const abs = path.resolve(file)
if (!fs.existsSync(abs)) {
  console.error(`No such file: ${abs}`)
  process.exit(1)
}
const buf = fs.readFileSync(abs)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const now = new Date('2026-09-28T00:00:00Z')

const wb = readWorkbook(ab)
const sheetName = bestSheet(inspectWorkbook(wb))
const { rows } = parseSheet(wb, path.basename(abs), { now, sheetName })

const t0 = performance.now()
const store = buildStore(rows)
const buildMs = performance.now() - t0

console.log(`file        ${path.basename(abs)}  sheet "${sheetName}"`)
console.log(`rows        ${rows.length.toLocaleString()}`)
console.log(`index       ${(storeBytes(store) / 1e6).toFixed(1)} MB, built in ${buildMs.toFixed(0)} ms`)
const dicts = Object.values(store.columns).filter((c) => c.kind === 'dict')
console.log(`dictionaries ${dicts.length} columns, ${dicts.reduce((a, c) => a + (c as { dict: string[] }).dict.length, 0).toLocaleString()} distinct strings\n`)

const OPEN = ['exploitable', 'patchable', 'surface', 'repo', 'severity']
const DIMS = ['environment', 'facing', 'packageName', 'namespace', 'serviceOwner']
const someRepos = [...new Set(rows.map((r) => String(r.repo)))].slice(0, 3)
const someSev = [...new Set(rows.map((r) => String(r.severity)))].slice(0, 2)

const cases: [string, FilterState][] = [
  ['no filters', { ...EMPTY_FILTERS }],
  ['one term', { ...EMPTY_FILTERS, q: 'netty' }],
  ['two terms', { ...EMPTY_FILTERS, q: 'netty handler' }],
  ['term with no hits', { ...EMPTY_FILTERS, q: 'zzzznothing' }],
  ['one facet', { ...EMPTY_FILTERS, facets: { severity: someSev.slice(0, 1) } }],
  ['two facets', { ...EMPTY_FILTERS, facets: { severity: someSev, patchable: ['Yes'] } }],
  ['repo multi-select', { ...EMPTY_FILTERS, facets: { repo: someRepos } }],
  ['facet on a counted key', { ...EMPTY_FILTERS, facets: { repo: someRepos, surface: ['Code'] } }],
  ['facets + text', { ...EMPTY_FILTERS, q: 'io', facets: { severity: someSev, patchable: ['Yes'] } }],
  ['cvss range', { ...EMPTY_FILTERS, cvssMin: 7, cvssMax: 9 }],
  ['cvss range + facet', { ...EMPTY_FILTERS, cvssMin: 7, facets: { environment: ['Production'] } }],
  ['date range', { ...EMPTY_FILTERS, discoveredFrom: '2026-09-01', discoveredTo: '2026-09-20' }],
  ['cveOnly', { ...EMPTY_FILTERS, cveOnly: true }],
  ['cveOnly + facet', { ...EMPTY_FILTERS, cveOnly: true, facets: { severity: someSev } }],
  ['blank facet value', { ...EMPTY_FILTERS, facets: { distro: ['(blank)'] } }],
  ['unsatisfiable facet', { ...EMPTY_FILTERS, facets: { severity: ['NoSuchSeverity'] } }],
]

const J = (x: unknown) => JSON.stringify(x)
let failures = 0

for (const [name, f] of cases) {
  const diffs: string[] = []

  const oldRows = applyFilters(rows, f)
  const newRows = selectRows(rows, store, f)
  if (oldRows.length !== newRows.length || oldRows.some((r, i) => r.id !== newRows[i].id)) diffs.push('rows')

  const oldFacets = facetValuesMany(rows, f, OPEN)
  const newFacets = facetCounts(store, f, OPEN)
  for (const k of OPEN) if (J(oldFacets.get(k)) !== J(newFacets.get(k))) diffs.push(`facet:${k}`)

  const cs = overviewStats(store, selectIndices(store, f), DIMS)
  if (J(cs.kpis) !== J(computeKpis(oldRows))) diffs.push('kpis')
  if (J(cs.severity) !== J(severityBreakdown(oldRows))) diffs.push('severity')
  if (J(cs.triage) !== J(triageBreakdown(oldRows))) diffs.push('triage')
  if (J(cs.age) !== J(ageBreakdown(oldRows))) diffs.push('age')
  if (J(cs.matrix) !== J(exploitPatchMatrix(oldRows))) diffs.push('matrix')
  if (J(cs.surface) !== J(stackedBySeverity(oldRows, 'surface', 4))) diffs.push('surface')
  if (J(cs.repo) !== J(stackedBySeverity(oldRows, 'repo', 12))) diffs.push('repo')
  if (J(cs.trend) !== J(discoveryTrend(oldRows))) diffs.push('trend')
  for (const d of DIMS) if (J(cs.dimensions[d]) !== J(countBy(oldRows, d))) diffs.push(`dim:${d}`)

  if (diffs.length) failures++
  console.log(
    `  ${diffs.length ? 'FAIL' : 'OK  '}  ${name.padEnd(24)} ${String(oldRows.length).padStart(7)} rows` +
      (diffs.length ? `   differs: ${diffs.join(', ')}` : ''),
  )
}

// --- throughput, on the widest selection available ------------------------
const f = cases[0][1]
const filtered = selectRows(rows, store, f)
const bench = (label: string, fn: () => unknown, n = 5) => {
  fn()
  const t = performance.now()
  for (let i = 0; i < n; i++) fn()
  console.log(`  ${label.padEnd(42)} ${((performance.now() - t) / n).toFixed(1).padStart(7)} ms`)
}
console.log(`\nTHROUGHPUT — one filter change over ${filtered.length.toLocaleString()} rows`)
bench('row-object: filter + facets + stats', () => {
  const r = applyFilters(rows, f)
  facetValuesMany(rows, f, OPEN)
  computeKpis(r); severityBreakdown(r); triageBreakdown(r); ageBreakdown(r)
  exploitPatchMatrix(r); stackedBySeverity(r, 'surface', 4); stackedBySeverity(r, 'repo', 12)
  DIMS.map((k) => countBy(r, k)); discoveryTrend(r)
})
bench('columnar: same work', () => {
  selectRows(rows, store, f)
  facetCounts(store, f, OPEN)
  overviewStats(store, selectIndices(store, f), DIMS)
})

console.log('')
if (failures) {
  console.error(`FAIL  ${failures} case(s) differ between the two implementations`)
  process.exit(1)
}
console.log('PASS  columnar path matches the row-object path on every case')
