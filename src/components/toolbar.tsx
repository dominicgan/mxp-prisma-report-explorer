import {
  CheckIcon,
  DownloadIcon,
  HistoryIcon,
  InfoIcon,
  Link2Icon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  LayersIcon,
  SheetIcon,
  SunIcon,
  WifiIcon,
  WifiOffIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useTheme, type Theme } from '@/components/theme-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CVE_SOURCES } from '@/lib/cve'
import { liveLookupEnabled, setLiveLookup } from '@/lib/cve-data'
import { num } from '@/lib/format'
import { countActiveFilters, type FilterState } from '@/lib/filters'
import type { ReportMeta, SheetInfo } from '@/lib/parse'
import type { Recall } from '@/lib/sheet-prefs'
import { FIELD_BY_KEY } from '@/lib/schema'
import { cn } from '@/lib/utils'

const DERIVED_LABELS: Record<string, string> = {
  surface: 'Surface',
  exploitable: 'Exploitable',
  patchable: 'Patchable',
  triage: 'Triage class',
  ageBucket: 'Age',
  tagStream: 'Branch / stream',
  tagVersion: 'Version',
  imageAgeBucket: 'Image age',
}

function labelFor(key: string) {
  return DERIVED_LABELS[key] ?? FIELD_BY_KEY.get(key)?.label ?? key
}

export function Toolbar({
  filters,
  setFilters,
  clearAll,
  total,
  shown,
  meta,
  cveSource,
  setCveSource,
  onExport,
  onNewFile,
  sheets,
  onSwitchSheet,
  recalled,
  onForgetSheet,
  supersededCount,
}: {
  filters: FilterState
  setFilters: (f: FilterState) => void
  clearAll: () => void
  total: number
  shown: number
  meta: ReportMeta
  cveSource: string
  setCveSource: (s: string) => void
  onExport: () => void
  onNewFile: () => void
  sheets: SheetInfo[]
  onSwitchSheet: (name: string) => void
  recalled: Recall | null
  onForgetSheet: () => void
  /** Findings on images that a newer build of the same branch has replaced. */
  supersededCount: number
}) {
  const active = countActiveFilters(filters)
  const filtered = shown !== total

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
      <div className="relative min-w-[200px] flex-1">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          placeholder="Search CVE, package, repo, namespace, image, owner…"
          className="h-8 pr-8 pl-8 text-xs"
        />
        {filters.q && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-0.5 size-7 -translate-y-1/2"
            onClick={() => setFilters({ ...filters, q: '' })}
            aria-label="Clear search"
          >
            <XIcon className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {filtered ? (
          <>
            <span className="text-foreground font-medium">{num(shown)}</span> of {num(total)}
          </>
        ) : (
          <>
            <span className="text-foreground font-medium">{num(total)}</span> findings
          </>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md border px-2 py-1',
              !filters.latestOnly && 'border-sev-high/40 bg-sev-high/10',
            )}
          >
            <LayersIcon
              className={cn('size-3.5', filters.latestOnly ? 'text-muted-foreground' : 'text-sev-high')}
            />
            <Label htmlFor="latest-only" className="cursor-pointer text-xs font-normal">
              Latest images only
            </Label>
            <Switch
              id="latest-only"
              checked={filters.latestOnly}
              onCheckedChange={(v) => setFilters({ ...filters, latestOnly: v })}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm">
          {filters.latestOnly ? (
            <>
              Showing only the newest image in each repo + branch pair.
              {supersededCount > 0 && (
                <>
                  {' '}
                  <span className="font-medium">{num(supersededCount)} findings</span> on images that a newer
                  build has replaced are hidden — many will already be fixed.
                </>
              )}
              <span className="text-muted-foreground mt-1 block">
                Recency comes from the build timestamp in the image tag. Turn this off to see history.
              </span>
            </>
          ) : (
            <>
              Showing <span className="font-medium">every image in the export</span>, including builds that
              have since been replaced. Counts here include findings that may already be fixed.
            </>
          )}
        </TooltipContent>
      </Tooltip>

      {active > 0 && (
        <Button variant="ghost" size="xs" onClick={clearAll}>
          <XIcon />
          Clear {active} filter{active === 1 ? '' : 's'}
        </Button>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {sheets.length > 1 && (
          <SheetSwitcher
            sheets={sheets}
            current={meta.sheetName}
            choice={meta.sheetChoice}
            recalled={recalled}
            onSwitch={onSwitchSheet}
            onForget={onForgetSheet}
          />
        )}

        <CopyLinkButton />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <Link2Icon />
                  <span className="sr-only">CVE lookup database</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>CVE links currently open {CVE_SOURCES.find((s) => s.id === cveSource)?.label}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Open CVE links in</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {CVE_SOURCES.map((s) => (
              <DropdownMenuItem key={s.id} onSelect={() => setCveSource(s.id)} className="items-start gap-2">
                <CheckIcon className={cveSource === s.id ? 'mt-0.5 opacity-100' : 'mt-0.5 opacity-0'} />
                <span className="min-w-0">
                  <span className="block font-medium">{s.label}</span>
                  <span className="text-muted-foreground block text-xs">{s.hint}</span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <LiveLookupToggle />
          </DropdownMenuContent>
        </DropdownMenu>

        <ReportInfo meta={meta} />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={onExport}>
              <DownloadIcon />
              <span className="sr-only">Export CSV</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export the current view as CSV</TooltipContent>
        </Tooltip>

        <ThemeToggle />

        <Button variant="outline" size="xs" onClick={onNewFile}>
          <UploadIcon />
          New file
        </Button>
      </div>

      {active > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1">
          {filters.cveOnly && (
            <Chip label="Has CVE" onClear={() => setFilters({ ...filters, cveOnly: false })} />
          )}
          {(filters.cvssMin != null || filters.cvssMax != null) && (
            <Chip
              label={`CVSS ${filters.cvssMin ?? 0}-${filters.cvssMax ?? 10}`}
              onClear={() => setFilters({ ...filters, cvssMin: undefined, cvssMax: undefined })}
            />
          )}
          {(filters.discoveredFrom || filters.discoveredTo) && (
            <Chip
              label={`Discovered ${filters.discoveredFrom ?? '…'} → ${filters.discoveredTo ?? '…'}`}
              onClear={() => setFilters({ ...filters, discoveredFrom: undefined, discoveredTo: undefined })}
            />
          )}
          {Object.entries(filters.facets).map(([k, vals]) =>
            vals.length ? (
              <Chip
                key={k}
                label={`${labelFor(k)}: ${vals.length > 2 ? `${vals.length} selected` : vals.join(', ')}`}
                title={vals.join('\n')}
                onClear={() => {
                  const facets = { ...filters.facets }
                  delete facets[k]
                  setFilters({ ...filters, facets })
                }}
              />
            ) : null,
          )}
        </div>
      )}
    </div>
  )
}

const SHEET_CHOICE_LABEL: Record<ReportMeta['sheetChoice'], string> = {
  'only-sheet': 'the only sheet',
  remembered: 'remembered from a previous upload',
  chosen: 'chosen by you',
  auto: 'auto-selected',
}

/**
 * Switching sheets re-parses the workbook already in memory, so it is instant.
 * The new choice replaces the remembered one for this file.
 */
function SheetSwitcher({
  sheets,
  current,
  choice,
  recalled,
  onSwitch,
  onForget,
}: {
  sheets: SheetInfo[]
  current: string
  choice: ReportMeta['sheetChoice']
  recalled: Recall | null
  onSwitch: (name: string) => void
  onForget: () => void
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="max-w-[200px] gap-1.5">
              <SheetIcon />
              <span className="truncate">{current}</span>
              {choice === 'remembered' && <HistoryIcon className="shrink-0 opacity-60" />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Reading sheet &ldquo;{current}&rdquo; - {SHEET_CHOICE_LABEL[choice]}. Click to switch.
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Sheet to read ({sheets.length} in this workbook)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sheets.map((s) => (
          <DropdownMenuItem key={s.name} onSelect={() => onSwitch(s.name)} className="items-start gap-2">
            <CheckIcon className={s.name === current ? 'mt-0.5 opacity-100' : 'mt-0.5 opacity-0'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="text-muted-foreground block text-xs tabular-nums">
                {s.rowCount === 0
                  ? 'Empty sheet'
                  : `~${num(s.dataRowEstimate)} rows \u00b7 ${s.mappedColumns} recognised columns`}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        {recalled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onForget}>
              <HistoryIcon />
              Stop remembering this choice
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Hovering a CVE calls OSV and EPSS. Some environments will not allow an
 * analyst's browser to reach third-party APIs, so the lookup can be switched
 * off and the choice is remembered.
 */
function LiveLookupToggle() {
  const [on, setOn] = useState(liveLookupEnabled)
  return (
    <DropdownMenuItem
      className="items-start gap-2"
      onSelect={(e) => {
        e.preventDefault()
        const next = !on
        setLiveLookup(next)
        setOn(next)
      }}
    >
      {on ? <WifiIcon className="mt-0.5" /> : <WifiOffIcon className="mt-0.5" />}
      <span className="min-w-0">
        <span className="block font-medium">Live detail on hover: {on ? 'on' : 'off'}</span>
        <span className="text-muted-foreground block text-xs">
          Looks up OSV and EPSS by CVE id when you hover a CVE. No report content is sent.
        </span>
      </span>
    </DropdownMenuItem>
  )
}

function Chip({ label, title, onClear }: { label: string; title?: string; onClear: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 py-1 pr-1 pl-2 font-normal" title={title}>
      <span className="max-w-[260px] truncate">{label}</span>
      <button type="button" onClick={onClear} className="hover:bg-background/60 rounded p-0.5" aria-label="Remove filter">
        <XIcon className="size-3" />
      </button>
    </Badge>
  )
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            navigator.clipboard.writeText(location.href)
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          }}
        >
          {copied ? <CheckIcon /> : <Link2Icon />}
          <span className="sr-only">Copy link to this view</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {copied ? 'Copied' : 'Copy a link to this exact filtered view'}
      </TooltipContent>
    </Tooltip>
  )
}

function ReportInfo({ meta }: { meta: ReportMeta }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <InfoIcon />
          <span className="sr-only">Report details</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="space-y-2 p-3 text-xs">
          <div className="font-medium break-all">{meta.fileName}</div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Sheet</dt>
            <dd>
              {meta.sheetName}
              <span className="text-muted-foreground"> ({SHEET_CHOICE_LABEL[meta.sheetChoice]})</span>
            </dd>
            <dt className="text-muted-foreground">Data rows</dt>
            <dd className="tabular-nums">{num(meta.rowCount)}</dd>
            {meta.reportedTotal != null && meta.reportedTotal !== meta.rowCount && (
              <>
                <dt className="text-muted-foreground">Export total</dt>
                <dd className="tabular-nums">
                  {num(meta.reportedTotal)}
                  <span className="text-muted-foreground"> (from the sheet&rsquo;s own Total row)</span>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Columns mapped</dt>
            <dd className="tabular-nums">{meta.presentKeys.length}</dd>
            <dt className="text-muted-foreground">Footer rows skipped</dt>
            <dd className="tabular-nums">{num(meta.skippedRows)}</dd>
            <dt className="text-muted-foreground">Fingerprint</dt>
            <dd className="font-mono">{meta.fingerprint}</dd>
          </dl>

          {meta.unmappedHeaders.length > 0 && (
            <div className="border-t pt-2">
              <div className="text-muted-foreground mb-1">
                {meta.unmappedHeaders.length} unrecognised column
                {meta.unmappedHeaders.length === 1 ? '' : 's'} (kept, available in the column chooser)
              </div>
              <div className="break-words">{meta.unmappedHeaders.join(', ')}</div>
            </div>
          )}

          {meta.appliedFilters && (
            <div className="border-t pt-2">
              <div className="text-muted-foreground mb-1">Filters applied when this report was exported</div>
              <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-[11px] break-words whitespace-pre-wrap">
                {meta.appliedFilters}
              </pre>
              <p className="text-muted-foreground mt-1.5">
                Anything excluded here is invisible to this dashboard - the numbers below describe the export, not
                the whole estate.
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const options: { value: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'system', label: 'System', icon: MonitorIcon },
  ]
  const Current = options.find((o) => o.value === theme)?.icon ?? MoonIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <Current />
          <span className="sr-only">Colour mode</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setTheme(o.value)}>
            <o.icon />
            {o.label}
            {theme === o.value && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
