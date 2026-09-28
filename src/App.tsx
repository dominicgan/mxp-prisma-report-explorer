import type { GridApi } from 'ag-grid-community'
import { PanelLeftIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  AgeChart,
  DimensionChart,
  RepoChart,
  SeverityChart,
  SurfaceChart,
  TrendChart,
  TriageMatrix,
} from '@/components/charts/dashboard-charts'
import { FacetPanel } from '@/components/facet-panel'
import { FindingDetail } from '@/components/finding-detail'
import { exportGridCsv, FindingsGrid } from '@/components/findings-grid'
import { KpiCards } from '@/components/kpi-cards'
import { CveGrid, FixGrid } from '@/components/rollup-grids'
import { SheetPicker } from '@/components/sheet-picker'
import { ThemeProvider } from '@/components/theme-provider'
import { Toolbar } from '@/components/toolbar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { UploadZone } from '@/components/upload-zone'
import { useEffectiveFilters, useFilteredRows, useFilters, useReport } from '@/hooks/use-report'
import { DEFAULT_CVE_SOURCE } from '@/lib/cve'
import { setFacet, toggleFacet } from '@/lib/filters'
import type { Finding } from '@/lib/parse'
import { bestSheet } from '@/lib/parse'
import { computeKpis } from '@/lib/stats'
import { cn } from '@/lib/utils'

const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/prisma-sample-dump.xlsx`

function Explorer() {
  const report = useReport()
  const { filters, setFilters, clearAll } = useFilters()
  const [cveSource, setCveSource] = useState(DEFAULT_CVE_SOURCE)
  const [selected, setSelected] = useState<Finding | null>(null)
  const [gridApi, setGridApi] = useState<GridApi<Finding> | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [tab, setTab] = useState('overview')

  // Leaving the Findings tab closes the detail sheet: it belongs to a row in
  // that grid, and leaving it open over a different view reads as a bug.
  const changeTab = useCallback((next: string) => {
    setTab(next)
    if (next !== 'findings') setSelected(null)
  }, [])

  const rows = report.rows
  const effective = useEffectiveFilters(filters)
  const filtered = useFilteredRows(rows, effective)
  const kpis = useMemo(() => computeKpis(filtered), [filtered])

  /** Which facet keys this particular export actually has values for. */
  const availableKeys = useMemo(() => {
    const keys = new Set<string>(report.meta?.presentKeys ?? [])
    for (const k of ['surface', 'exploitable', 'patchable', 'triage', 'ageBucket']) keys.add(k)
    // Drop facets where every row is blank - an empty facet is just noise.
    for (const k of [...keys]) {
      if (!rows.some((r) => r[k] != null && r[k] !== '')) keys.delete(k)
    }
    return keys
  }, [report.meta, rows])

  const loadSample = useCallback(async () => {
    const res = await fetch(SAMPLE_URL)
    if (!res.ok) return
    const blob = await res.blob()
    await report.load(blob, 'prisma-sample-dump.xlsx')
  }, [report])

  const only = useCallback(
    (key: string, value: string) => setFilters(setFacet(filters, key, [value])),
    [filters, setFilters],
  )
  const toggle = useCallback(
    (key: string, value: string) => setFilters(toggleFacet(filters, key, value)),
    [filters, setFilters],
  )

  const kpiActions = useMemo(
    () => ({
      onSeverity: (sev: string) => only('severity', sev),
      onExploitable: () => only('exploitable', 'Yes'),
      onActionable: () =>
        setFilters({ ...filters, facets: { ...filters.facets, exploitable: ['Yes'], patchable: ['Yes'] } }),
      onNoPatch: () => only('patchable', 'No'),
      onSurface: (s: string) => only('surface', s),
      onProdExternal: () =>
        setFilters({
          ...filters,
          facets: { ...filters.facets, environment: ['Production'], facing: ['External Facing'] },
        }),
      onBreachedKpi: () => {
        const values = [...new Set(rows.map((r) => String(r.kpiStatus ?? '')))].filter(
          (v) => v && !v.toLowerCase().startsWith('within'),
        )
        setFilters(setFacet(filters, 'kpiStatus', values))
      },
    }),
    [filters, setFilters, only, rows],
  )

  if (report.status === 'choosing' && report.fileName) {
    return (
      <SheetPicker
        fileName={report.fileName}
        sheets={report.sheets}
        recalled={report.recalled}
        defaultSheet={bestSheet(report.sheets)}
        onChoose={report.chooseSheet}
        onCancel={report.reset}
      />
    )
  }

  if (report.status !== 'ready' || !report.meta) {
    return (
      <UploadZone
        onFile={(f) => report.load(f, f.name)}
        status={report.status}
        error={report.error}
        onLoadSample={loadSample}
        onBackToSheets={report.sheets.length > 1 ? report.reopenPicker : undefined}
        progress={report.progress}
      />
    )
  }

  const meta = report.meta

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        filters={filters}
        setFilters={setFilters}
        clearAll={clearAll}
        total={rows.length}
        shown={filtered.length}
        meta={meta}
        cveSource={cveSource}
        setCveSource={setCveSource}
        onExport={() => exportGridCsv(gridApi, `${meta.fileName.replace(/\.[^.]+$/, '')}-filtered.csv`)}
        onNewFile={report.reset}
        sheets={report.sheets}
        onSwitchSheet={report.switchSheet}
        recalled={report.recalled}
        onForgetSheet={report.forgetChoice}
      />

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'bg-card/40 w-64 shrink-0 border-r transition-[width] duration-150',
            !sidebarOpen && 'w-0 overflow-hidden border-r-0',
          )}
        >
          <FacetPanel
            rows={rows}
            filters={filters}
            countBasis={effective}
            setFilters={setFilters}
            availableKeys={availableKeys}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <Tabs value={tab} onValueChange={changeTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSidebarOpen((s) => !s)}
                aria-label={sidebarOpen ? 'Hide filters' : 'Show filters'}
              >
                <PanelLeftIcon />
              </Button>
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="findings">Findings</TabsTrigger>
                <TabsTrigger value="cves">By CVE</TabsTrigger>
                <TabsTrigger value="fixes">Remediation</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="min-h-0 data-[state=inactive]:hidden">
              <ScrollArea className="h-full">
                <div className="space-y-3 p-3">
                  <KpiCards kpis={kpis} actions={kpiActions} />
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    <SeverityChart rows={filtered} onSelect={(s) => only('severity', s)} />
                    <TriageMatrix
                      rows={filtered}
                      onSelect={(e, p) =>
                        setFilters({
                          ...filters,
                          facets: { ...filters.facets, exploitable: [e], patchable: [p] },
                        })
                      }
                    />
                    <SurfaceChart rows={filtered} />
                    <RepoChart rows={filtered} onSelect={(r) => toggle('repo', r)} />
                    <div className="grid gap-3">
                      <DimensionChart
                        rows={filtered}
                        dimension="environment"
                        title="Environment"
                        description="Where the affected images are running"
                        onSelect={(v) => toggle('environment', v)}
                        height={150}
                        topN={5}
                      />
                      <DimensionChart
                        rows={filtered}
                        dimension="facing"
                        title="Exposure"
                        description="Internal vs internet-facing"
                        onSelect={(v) => toggle('facing', v)}
                        height={150}
                        topN={5}
                      />
                    </div>
                    <div className="grid gap-3">
                      <AgeChart rows={filtered} />
                      <TrendChart rows={filtered} />
                    </div>
                    <DimensionChart
                      rows={filtered}
                      dimension="packageName"
                      title="Top packages"
                      description="Which dependency shows up most"
                      onSelect={(v) => toggle('packageName', v)}
                      height={220}
                    />
                    <DimensionChart
                      rows={filtered}
                      dimension="namespace"
                      title="Namespaces"
                      description="Cluster namespaces carrying findings"
                      onSelect={(v) => toggle('namespace', v)}
                      height={220}
                    />
                    <DimensionChart
                      rows={filtered}
                      dimension="serviceOwner"
                      title="Service owners"
                      description="Who to route remediation to"
                      onSelect={(v) => toggle('serviceOwner', v)}
                      height={220}
                    />
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="findings" className="min-h-0 data-[state=inactive]:hidden">
              <FindingsGrid
                rows={filtered}
                cveSource={cveSource}
                onRowClick={setSelected}
                onApiReady={setGridApi}
              />
            </TabsContent>

            <TabsContent value="cves" className="min-h-0 data-[state=inactive]:hidden">
              <CveGrid rows={filtered} cveSource={cveSource} onSelect={(cve) => only('cve', cve)} />
            </TabsContent>

            <TabsContent value="fixes" className="min-h-0 data-[state=inactive]:hidden">
              <FixGrid rows={filtered} onSelect={(pkg) => only('packageName', pkg)} />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <FindingDetail
        finding={selected}
        cveSource={cveSource}
        onClose={() => setSelected(null)}
        onFilterBy={(k, v) => {
          only(k, v)
          setSelected(null)
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <Explorer />
      </TooltipProvider>
    </ThemeProvider>
  )
}
