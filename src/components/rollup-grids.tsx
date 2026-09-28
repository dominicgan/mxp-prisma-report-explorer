import {
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
  type ColDef,
  type ValueFormatterParams,
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { useMemo } from 'react'
import { CveLink, SeverityBadge, SurfaceBadge } from '@/components/badges'
import { useTheme } from '@/components/theme-provider'
import { Badge } from '@/components/ui/badge'
import { cvss as fmtCvss, date as fmtDate, shortRepo, truncate } from '@/lib/format'
import type { Finding } from '@/lib/parse'
import { severityRank } from '@/lib/schema'
import { rollupByCve, rollupByFix, type CveRollup, type FixRollup } from '@/lib/stats'

const base = themeQuartz.withParams({
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--card-foreground)',
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--muted-foreground)',
  borderColor: 'var(--border)',
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: 'var(--accent)',
  accentColor: 'var(--ring)',
  fontFamily: 'inherit',
  fontSize: '12px',
  headerFontSize: '11px',
  headerFontWeight: 600,
  rowHeight: 40,
  headerHeight: 36,
  wrapperBorderRadius: '0px',
  cellHorizontalPadding: 10,
})
const dark = base.withPart(colorSchemeDark)
const light = base.withPart(colorSchemeLight)

const defaultColDef: ColDef = {
  sortable: true,
  resizable: true,
  filter: true,
  cellClass: 'flex items-center',
}

function listFormatter(p: ValueFormatterParams) {
  return Array.isArray(p.value) ? p.value.join(', ') : String(p.value ?? '')
}

function ListCell({ values, render }: { values: string[]; render?: (v: string) => string }) {
  if (!values.length) return <span className="text-muted-foreground">-</span>
  const shown = values.slice(0, 2).map((v) => (render ? render(v) : v))
  return (
    <span className="flex min-w-0 items-center gap-1" title={values.join('\n')}>
      <span className="truncate">{shown.join(', ')}</span>
      {values.length > 2 && (
        <Badge variant="secondary" className="shrink-0 px-1 tabular-nums">
          +{values.length - 2}
        </Badge>
      )}
    </span>
  )
}

/**
 * One row per CVE with its blast radius: how many findings, how many repos, is
 * any instance exploitable, is any patchable.
 */
export function CveGrid({
  rows,
  cveSource,
  onSelect,
}: {
  rows: Finding[]
  cveSource: string
  onSelect?: (cve: string) => void
}) {
  const { resolved } = useTheme()
  const data = useMemo(() => rollupByCve(rows), [rows])

  const columnDefs = useMemo<ColDef<CveRollup>[]>(
    () => [
      {
        field: 'severity',
        headerName: 'Severity',
        width: 110,
        pinned: 'left',
        comparator: (a, b) => severityRank(a) - severityRank(b),
        cellRenderer: (p: { value: unknown }) => <SeverityBadge severity={p.value} />,
      },
      {
        field: 'cve',
        headerName: 'Identifier',
        width: 170,
        pinned: 'left',
        cellRenderer: (p: { value: unknown; data?: CveRollup }) => (
          <CveLink
            cve={p.value}
            source={cveSource}
            preview={{
              severity: p.data?.severity,
              cvss: p.data?.cvss,
              description: p.data?.description,
              status: p.data?.status,
              fixDate: p.data?.fixDate,
              packageName: p.data?.packages?.[0],
            }}
          />
        ),
      },
      { field: 'cvss', headerName: 'CVSS', width: 80, type: 'numericColumn', valueFormatter: (p) => fmtCvss(p.value) },
      { field: 'findings', headerName: 'Findings', width: 100, type: 'numericColumn', sort: 'desc' },
      { field: 'repos', headerName: 'Repos', width: 88, type: 'numericColumn' },
      { field: 'namespaces', headerName: 'Namespaces', width: 116, type: 'numericColumn' },
      {
        field: 'exploitable',
        headerName: 'Exploitable',
        width: 116,
        cellRenderer: (p: { value: boolean }) =>
          p.value ? (
            <Badge variant="outline" className="border-sev-high/40 bg-sev-high/15 text-sev-high">
              Any exploitable
            </Badge>
          ) : (
            <span className="text-muted-foreground">No</span>
          ),
      },
      {
        field: 'patchable',
        headerName: 'Patchable',
        width: 110,
        cellRenderer: (p: { value: boolean }) =>
          p.value ? (
            <Badge variant="outline" className="border-sev-low/40 bg-sev-low/15 text-sev-low">
              Patch exists
            </Badge>
          ) : (
            <span className="text-muted-foreground">No patch</span>
          ),
      },
      {
        field: 'surfaces',
        headerName: 'Surface',
        width: 126,
        valueFormatter: listFormatter,
        cellRenderer: (p: { value: string[] }) =>
          p.value?.length === 1 ? <SurfaceBadge surface={p.value[0]} /> : <ListCell values={p.value ?? []} />,
      },
      {
        field: 'packages',
        headerName: 'Packages',
        width: 240,
        valueFormatter: listFormatter,
        cellRenderer: (p: { value: string[] }) => <ListCell values={p.value ?? []} />,
      },
      {
        field: 'repoList',
        headerName: 'Repositories',
        width: 280,
        valueFormatter: listFormatter,
        cellRenderer: (p: { value: string[] }) => <ListCell values={p.value ?? []} render={shortRepo} />,
      },
      {
        field: 'environments',
        headerName: 'Environments',
        width: 150,
        valueFormatter: listFormatter,
        cellRenderer: (p: { value: string[] }) => <ListCell values={p.value ?? []} />,
      },
      { field: 'oldestDiscovered', headerName: 'First seen', width: 120, valueFormatter: (p) => fmtDate(p.value) },
      { field: 'fixDate', headerName: 'Fix date', width: 112, valueFormatter: (p) => fmtDate(p.value) },
      { field: 'status', headerName: 'Fix status', width: 220 },
      {
        field: 'description',
        headerName: 'Description',
        width: 420,
        tooltipField: 'description',
        valueFormatter: (p) => truncate(p.value, 300),
      },
    ],
    [cveSource],
  )

  return (
    <AgGridReact<CveRollup>
      theme={resolved === 'dark' ? dark : light}
      rowData={data}
      columnDefs={columnDefs}
      defaultColDef={defaultColDef}
      getRowId={(p) => p.data.cve}
      onRowClicked={(e) => e.data && onSelect?.(e.data.cve)}
      rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
      suppressCellFocus
      animateRows={false}
      tooltipShowDelay={300}
      overlayNoRowsTemplate={'<span class="text-xs text-muted-foreground">No CVEs match the current filters</span>'}
    />
  )
}

/**
 * One row per package: "if I bump this one dependency, how many findings close
 * and which repos do I have to touch?"
 */
export function FixGrid({ rows, onSelect }: { rows: Finding[]; onSelect?: (pkg: string) => void }) {
  const { resolved } = useTheme()
  const data = useMemo(() => rollupByFix(rows), [rows])

  const columnDefs = useMemo<ColDef<FixRollup>[]>(
    () => [
      {
        field: 'worstSeverity',
        headerName: 'Worst',
        width: 104,
        pinned: 'left',
        comparator: (a, b) => severityRank(a) - severityRank(b),
        cellRenderer: (p: { value: unknown }) => <SeverityBadge severity={p.value} />,
      },
      { field: 'packageName', headerName: 'Package', width: 250, pinned: 'left', tooltipField: 'packageName' },
      { field: 'findings', headerName: 'Findings closed', width: 140, type: 'numericColumn', sort: 'desc' },
      { field: 'repos', headerName: 'Repos to touch', width: 136, type: 'numericColumn' },
      { field: 'patchable', headerName: 'Patchable', width: 110, type: 'numericColumn' },
      { field: 'exploitable', headerName: 'Exploitable', width: 116, type: 'numericColumn' },
      {
        field: 'surface',
        headerName: 'Surface',
        width: 126,
        cellRenderer: (p: { value: unknown }) => <SurfaceBadge surface={p.value} />,
      },
      { field: 'packageType', headerName: 'Type', width: 96 },
      {
        field: 'versions',
        headerName: 'Affected versions',
        width: 210,
        valueFormatter: listFormatter,
        cellRenderer: (p: { value: string[] }) => <ListCell values={p.value ?? []} />,
      },
      { field: 'fixedIn', headerName: 'Fixed in', width: 240, tooltipField: 'fixedIn' },
      {
        field: 'cves',
        headerName: 'CVEs',
        width: 200,
        valueFormatter: listFormatter,
        cellRenderer: (p: { value: string[] }) => <ListCell values={p.value ?? []} />,
      },
      {
        field: 'repoList',
        headerName: 'Repositories',
        width: 320,
        valueFormatter: listFormatter,
        cellRenderer: (p: { value: string[] }) => <ListCell values={p.value ?? []} render={shortRepo} />,
      },
    ],
    [],
  )

  return (
    <AgGridReact<FixRollup>
      theme={resolved === 'dark' ? dark : light}
      rowData={data}
      columnDefs={columnDefs}
      defaultColDef={defaultColDef}
      getRowId={(p) => p.data.packageName}
      onRowClicked={(e) => e.data && onSelect?.(e.data.packageName)}
      rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
      suppressCellFocus
      animateRows={false}
      tooltipShowDelay={300}
      overlayNoRowsTemplate={
        '<span class="text-xs text-muted-foreground">No packages in the current selection</span>'
      }
    />
  )
}
