import { ChevronRightIcon, SearchIcon, XIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { num } from '@/lib/format'
import { clearFacet, facetValues, toggleFacet, type FilterState } from '@/lib/filters'
import type { Finding } from '@/lib/parse'
import { FIELD_BY_KEY } from '@/lib/schema'
import { cn } from '@/lib/utils'

/**
 * Facets in the order a triage conversation actually goes: what can hurt me,
 * where does it live, what do I have to change, who owns it.
 */
const FACET_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Triage', keys: ['exploitable', 'patchable', 'severity', 'triage', 'kpiStatus'] },
  { title: 'Surface', keys: ['surface', 'vulnerabilityCategory', 'packageType'] },
  { title: 'Location', keys: ['repo', 'namespace', 'environment', 'cluster', 'facing', 'ciStatus', 'distro', 'hostName', 'registry'] },
  { title: 'Package', keys: ['packageName', 'packageLicense'] },
  { title: 'Identifier', keys: ['cve', 'cvssSource'] },
  { title: 'Lifecycle', keys: ['ageBucket'] },
  { title: 'Business', keys: ['serviceName', 'serviceCriticality', 'serviceNumber', 'ciNumber', 'grcBu', 'bu', 'cmdbCategory', 'subscriptionName', 'resourceGroupName'] },
  { title: 'Ownership', keys: ['serviceOwner', 'namespaceOwner', 'clusterNamespaceOwner', 'namespaceAdminGroup', 'adminWorkGroup', 'clusterOwner', 'subscriptionOwner'] },
]

const DERIVED_LABELS: Record<string, string> = {
  surface: 'Container vs Code',
  exploitable: 'Exploitable',
  patchable: 'Patchable',
  triage: 'Triage class',
  ageBucket: 'Age',
}

function labelFor(key: string) {
  return DERIVED_LABELS[key] ?? FIELD_BY_KEY.get(key)?.label ?? key
}

/** Facets open by default - the ones the brief names explicitly. */
const DEFAULT_OPEN = new Set(['exploitable', 'patchable', 'surface', 'repo', 'severity'])

export function FacetPanel({
  rows,
  filters,
  setFilters,
  availableKeys,
}: {
  rows: Finding[]
  filters: FilterState
  setFilters: (f: FilterState) => void
  availableKeys: Set<string>
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(DEFAULT_OPEN))

  const groups = useMemo(
    () =>
      FACET_GROUPS.map((g) => ({
        ...g,
        keys: g.keys.filter((k) => availableKeys.has(k)),
      })).filter((g) => g.keys.length > 0),
    [availableKeys],
  )

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-3">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="text-muted-foreground mb-1.5 px-1 text-[11px] font-semibold tracking-wide uppercase">
              {g.title}
            </div>
            <div className="space-y-0.5">
              {g.keys.map((key) => (
                <Facet
                  key={key}
                  facetKey={key}
                  rows={rows}
                  filters={filters}
                  setFilters={setFilters}
                  isOpen={open.has(key)}
                  onToggleOpen={() =>
                    setOpen((s) => {
                      const n = new Set(s)
                      if (n.has(key)) n.delete(key)
                      else n.add(key)
                      return n
                    })
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

function Facet({
  facetKey,
  rows,
  filters,
  setFilters,
  isOpen,
  onToggleOpen,
}: {
  facetKey: string
  rows: Finding[]
  filters: FilterState
  setFilters: (f: FilterState) => void
  isOpen: boolean
  onToggleOpen: () => void
}) {
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)

  // Only computed while the facet is expanded - a 10k-row export has a lot of
  // distinct repos and package names, and most facets stay collapsed.
  const values = useMemo(
    () => (isOpen ? facetValues(rows, filters, facetKey) : []),
    [isOpen, rows, filters, facetKey],
  )

  const selectedCount = filters.facets[facetKey]?.length ?? 0
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? values.filter((v) => v.value.toLowerCase().includes(q)) : values
  }, [values, search])

  const visible = showAll ? filtered : filtered.slice(0, 8)
  const needsSearch = values.length > 8

  return (
    <div className="rounded-md">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onToggleOpen}
          className="hover:bg-accent flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1.5 text-left text-xs font-medium"
        >
          <ChevronRightIcon className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')} />
          <span className="truncate">{labelFor(facetKey)}</span>
          {selectedCount > 0 && (
            <Badge variant="secondary" className="ml-auto shrink-0 px-1 tabular-nums">
              {selectedCount}
            </Badge>
          )}
        </button>
        {selectedCount > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0"
            onClick={() => setFilters(clearFacet(filters, facetKey))}
            aria-label={`Clear ${labelFor(facetKey)} filter`}
          >
            <XIcon className="size-3" />
          </Button>
        )}
      </div>

      {isOpen && (
        <div className="space-y-1 pt-0.5 pb-1.5 pl-5">
          {needsSearch && (
            <div className="relative">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-2 size-3 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${values.length} values`}
                className="h-7 pl-7 text-xs"
              />
            </div>
          )}
          {visible.length === 0 && <div className="text-muted-foreground px-1 py-1 text-xs">No values</div>}
          {visible.map((v) => (
            <label
              key={v.value}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs"
            >
              <Checkbox
                checked={v.selected}
                onCheckedChange={() => setFilters(toggleFacet(filters, facetKey, v.value))}
              />
              <span className={cn('min-w-0 flex-1 truncate', v.count === 0 && 'text-muted-foreground')} title={v.value}>
                {v.value}
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">{num(v.count)}</span>
            </label>
          ))}
          {filtered.length > 8 && (
            <Button variant="ghost" size="xs" className="h-6 w-full justify-start px-1" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show less' : `Show all ${filtered.length}`}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
