import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  colorSchemeLight,
  themeQuartz,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type ValueFormatterParams,
} from 'ag-grid-community'
import { AgGridReact } from 'ag-grid-react'
import { useCallback, useMemo, useRef } from 'react'
import { CveLink, PatchBadge, SeverityBadge, SurfaceBadge, FlagBadge } from '@/components/badges'
import { useTheme } from '@/components/theme-provider'
import { cvss as fmtCvss, date as fmtDate } from '@/lib/format'
import type { Finding } from '@/lib/parse'
import { FIELDS, severityRank } from '@/lib/schema'

ModuleRegistry.registerModules([AllCommunityModule])

/**
 * The grid is themed from the same CSS variables as the rest of the app, so the
 * light/dark toggle moves the grid with everything else rather than leaving an
 * island of the wrong colour scheme.
 */
const quartz = themeQuartz.withParams({
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--card-foreground)',
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--muted-foreground)',
  borderColor: 'var(--border)',
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: 'var(--accent)',
  selectedRowBackgroundColor: 'color-mix(in oklab, var(--primary) 12%, transparent)',
  accentColor: 'var(--ring)',
  fontFamily: 'inherit',
  fontSize: '12px',
  headerFontSize: '11px',
  headerFontWeight: 600,
  rowHeight: 38,
  headerHeight: 36,
  wrapperBorderRadius: '0px',
  borderRadius: '4px',
  cellHorizontalPadding: 10,
})

const themeDark = quartz.withPart(colorSchemeDark)
const themeLight = quartz.withPart(colorSchemeLight)

const textFilter = { filter: 'agTextColumnFilter', filterParams: { buttons: ['reset'], maxNumConditions: 1 } }
const numFilter = { filter: 'agNumberColumnFilter', filterParams: { buttons: ['reset'] } }
const setish = { filter: 'agTextColumnFilter', filterParams: { buttons: ['reset'] } }

function dateFormatter(p: ValueFormatterParams) {
  return fmtDate(p.value)
}

/** Columns shown up front; everything else is available in the column chooser. */
const PRIMARY: ColDef<Finding>[] = [
  {
    field: 'severity',
    headerName: 'Severity',
    width: 108,
    pinned: 'left',
    comparator: (a, b) => severityRank(a) - severityRank(b),
    cellRenderer: (p: { value: unknown }) => <SeverityBadge severity={p.value} />,
    ...setish,
  },
  {
    field: 'cvss',
    headerName: 'CVSS',
    width: 78,
    type: 'numericColumn',
    valueFormatter: (p) => fmtCvss(p.value),
    ...numFilter,
  },
  {
    field: 'cve',
    headerName: 'CVE',
    width: 158,
    pinned: 'left',
    cellRenderer: (p: { value: unknown; data?: Finding; context?: { cveSource?: string } }) => (
      <CveLink
        cve={p.value}
        source={p.context?.cveSource}
        preview={{
          severity: p.data?.severity,
          cvss: p.data?.cvss,
          description: p.data?.description,
          status: p.data?.status,
          fixDate: p.data?.fixDate,
          packageName: p.data?.packageName,
          packageVersion: p.data?.packageVersion,
        }}
      />
    ),
    ...textFilter,
  },
  {
    field: 'surface',
    headerName: 'Surface',
    width: 122,
    cellRenderer: (p: { value: unknown; data?: Finding }) => (
      <SurfaceBadge surface={p.value} reason={p.data?.surfaceReason} />
    ),
    ...setish,
  },
  {
    field: 'exploitable',
    headerName: 'Exploitable',
    width: 130,
    cellRenderer: (p: { value: unknown }) => (
      <FlagBadge value={p.value} yesLabel="Exploitable" noLabel="Not exploitable" />
    ),
    ...setish,
  },
  {
    field: 'patchable',
    headerName: 'Patchable',
    width: 122,
    cellRenderer: (p: { value: unknown }) => <PatchBadge value={p.value} />,
    ...setish,
  },
  { field: 'repo', headerName: 'Repo', width: 250, tooltipField: 'repo', ...textFilter },
  { field: 'packageName', headerName: 'Package', width: 220, tooltipField: 'purl', ...textFilter },
  { field: 'packageVersion', headerName: 'Version', width: 120, ...textFilter },
  { field: 'namespace', headerName: 'Namespace', width: 190, ...textFilter },
  { field: 'environment', headerName: 'Env', width: 110, ...setish },
  { field: 'tag', headerName: 'Tag', width: 240, tooltipField: 'tag', ...textFilter },
  { field: 'discovered', headerName: 'Discovered', width: 120, valueFormatter: dateFormatter, ...textFilter },
  { field: 'ageDays', headerName: 'Age (d)', width: 92, type: 'numericColumn', ...numFilter },
]

const PRIMARY_KEYS = new Set(PRIMARY.map((c) => c.field as string))

/** Everything else from the schema, hidden until the user asks for it. */
const SECONDARY: ColDef<Finding>[] = FIELDS.filter((f) => !PRIMARY_KEYS.has(f.key)).map((f) => ({
  field: f.key,
  headerName: f.label,
  width: f.kind === 'date' ? 120 : 160,
  hide: true,
  ...(f.kind === 'date' ? { valueFormatter: dateFormatter, ...textFilter } : {}),
  ...(f.kind === 'number' ? { type: 'numericColumn', ...numFilter } : {}),
  ...(f.kind === 'string' || f.kind === 'enum' ? textFilter : {}),
}))

const EXTRA: ColDef<Finding>[] = [
  { field: 'triage', headerName: 'Triage Class', width: 190, hide: true, ...setish },
  { field: 'ageBucket', headerName: 'Age Bucket', width: 120, hide: true, ...setish },
  // Parsed out of the image tag.
  { field: 'tagStream', headerName: 'Branch / stream', width: 190, hide: true, ...setish },
  { field: 'tagVersion', headerName: 'Tag Version', width: 130, hide: true, ...setish },
  { field: 'tagBuild', headerName: 'Build #', width: 100, hide: true, type: 'numericColumn', ...numFilter },
  { field: 'tagBuiltAt', headerName: 'Image Built', width: 130, hide: true, valueFormatter: dateFormatter, ...textFilter },
  { field: 'imageAgeDays', headerName: 'Image Age (d)', width: 125, hide: true, type: 'numericColumn', ...numFilter },
  { field: 'imageAgeBucket', headerName: 'Image Age', width: 120, hide: true, ...setish },
  { field: 'surfaceReason', headerName: 'Why this surface', width: 260, hide: true, ...textFilter },
  { field: 'rowIndex', headerName: 'Sheet row', width: 100, hide: true, type: 'numericColumn', ...numFilter },
]

export interface FindingsGridHandle {
  api: GridApi<Finding> | null
}

export function FindingsGrid({
  rows,
  cveSource,
  onRowClick,
  onApiReady,
}: {
  rows: Finding[]
  cveSource: string
  onRowClick?: (row: Finding) => void
  onApiReady?: (api: GridApi<Finding>) => void
}) {
  const { resolved } = useTheme()
  const apiRef = useRef<GridApi<Finding> | null>(null)

  const columnDefs = useMemo<ColDef<Finding>[]>(() => [...PRIMARY, ...EXTRA, ...SECONDARY], [])

  const defaultColDef = useMemo<ColDef<Finding>>(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      suppressHeaderMenuButton: false,
      cellClass: 'flex items-center',
    }),
    [],
  )

  const onGridReady = useCallback(
    (e: GridReadyEvent<Finding>) => {
      apiRef.current = e.api
      onApiReady?.(e.api)
    },
    [onApiReady],
  )

  return (
    <div className="h-full w-full">
      <AgGridReact<Finding>
        theme={resolved === 'dark' ? themeDark : themeLight}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        context={{ cveSource }}
        getRowId={(p) => p.data.id}
        onGridReady={onGridReady}
        onRowClicked={(e) => e.data && onRowClick?.(e.data)}
        rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
        // Virtualised: only the visible window is in the DOM, so 10k+ rows
        // scroll without the browser doing 10k row layouts.
        rowBuffer={12}
        animateRows={false}
        suppressCellFocus
        tooltipShowDelay={300}
        overlayNoRowsTemplate={'<span class="text-xs text-muted-foreground">No findings match the current filters</span>'}
      />
    </div>
  )
}

/** CSV of exactly what is on screen, column order and all. */
export function exportGridCsv(api: GridApi<Finding> | null, fileName: string) {
  api?.exportDataAsCsv({
    fileName,
    allColumns: false,
    processCellCallback: (p) => {
      const v = p.value
      if (v == null) return ''
      const col = p.column.getColId()
      if (col === 'discovered' || col === 'fixDate' || col === 'scanTime' || col === 'initialNotification') {
        return fmtDate(v)
      }
      return v
    },
  })
}
