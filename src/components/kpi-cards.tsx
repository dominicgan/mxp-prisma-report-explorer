import {
  AlertTriangleIcon,
  BoxIcon,
  CodeIcon,
  FileWarningIcon,
  GlobeIcon,
  ShieldAlertIcon,
  TimerIcon,
  WrenchIcon,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { num, pct } from '@/lib/format'
import type { Kpis } from '@/lib/stats'
import { cn } from '@/lib/utils'

interface Tile {
  id: string
  label: string
  value: number | undefined
  sub?: string
  hint: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'critical' | 'high' | 'default'
  onClick?: () => void
}

export interface KpiActions {
  onSeverity?: (sev: string) => void
  onExploitable?: () => void
  onActionable?: () => void
  onNoPatch?: () => void
  onSurface?: (s: string) => void
  onProdExternal?: () => void
  onBreachedKpi?: () => void
}

export function KpiCards({ kpis, actions }: { kpis: Kpis; actions?: KpiActions }) {
  const total = kpis.findings

  const tiles: Tile[] = [
    {
      id: 'actionable',
      label: 'Fix first',
      value: kpis.actionable,
      sub: `${pct(kpis.actionable, total)} of findings`,
      hint: 'Exploitable AND patchable - there is a known exploit path and a patch exists. This is the highest-return queue.',
      icon: ShieldAlertIcon,
      tone: 'critical',
      onClick: actions?.onActionable,
    },
    {
      id: 'exploitable',
      label: 'Exploitable',
      value: kpis.exploitable,
      sub: `${pct(kpis.exploitable, total)} of findings`,
      hint: 'Prisma flagged a known exploit path, patch available or not.',
      icon: AlertTriangleIcon,
      tone: 'high',
      onClick: actions?.onExploitable,
    },
    {
      id: 'critical',
      label: 'Critical',
      value: kpis.critical,
      sub: `${num(kpis.high)} high`,
      hint: 'Findings at Critical severity. The sub-figure counts High.',
      icon: FileWarningIcon,
      tone: 'critical',
      onClick: () => actions?.onSeverity?.('Critical'),
    },
    {
      id: 'nopatch',
      label: 'No patch',
      value: kpis.noPatch,
      sub: `${pct(kpis.noPatch, total)} of findings`,
      hint: 'Not patchable - these need a mitigation, a version pin, or an accepted risk. Upgrading will not clear them.',
      icon: WrenchIcon,
      onClick: actions?.onNoPatch,
    },
    {
      id: 'container',
      label: 'Container',
      value: kpis.container,
      sub: 'OS / base image',
      hint: 'Vulnerabilities in OS packages from the base image - usually fixed by rebasing the image, not by changing app code.',
      icon: BoxIcon,
      onClick: () => actions?.onSurface?.('Container'),
    },
    {
      id: 'code',
      label: 'Code',
      value: kpis.code,
      sub: 'App dependencies',
      hint: 'Vulnerabilities in application dependencies - fixed by bumping the dependency in the repo.',
      icon: CodeIcon,
      onClick: () => actions?.onSurface?.('Code'),
    },
    {
      id: 'prodext',
      label: 'Prod + external',
      value: kpis.prodExternal,
      sub: 'Internet-facing',
      hint: 'Running in Production AND externally facing - the smallest blast radius to defend and the first place an attacker looks.',
      icon: GlobeIcon,
      tone: kpis.prodExternal > 0 ? 'high' : 'default',
      onClick: actions?.onProdExternal,
    },
    {
      id: 'age',
      label: 'Oldest open',
      value: kpis.oldestDays,
      sub: kpis.breachedKpi > 0 ? `${num(kpis.breachedKpi)} outside KPI` : 'days since discovery',
      hint: 'Days since the oldest finding in view was discovered. The sub-figure counts findings whose KPI status is not "Within KPI".',
      icon: TimerIcon,
      onClick: kpis.breachedKpi > 0 ? actions?.onBreachedKpi : undefined,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {tiles.map((t) => (
        <KpiTile key={t.id} tile={t} />
      ))}
    </div>
  )
}

function KpiTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon
  const interactive = Boolean(tile.onClick)

  const body = (
    <Card
      className={cn(
        'relative overflow-hidden p-3 transition-colors',
        interactive && 'hover:border-ring cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">{tile.label}</span>
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            tile.tone === 'critical' && 'text-sev-critical',
            tile.tone === 'high' && 'text-sev-high',
            (!tile.tone || tile.tone === 'default') && 'text-muted-foreground',
          )}
        />
      </div>
      <div className="mt-1.5 text-2xl leading-none font-semibold">{num(tile.value)}</div>
      {tile.sub && <div className="text-muted-foreground mt-1 text-[11px]">{tile.sub}</div>}
    </Card>
  )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {interactive ? (
          <button type="button" onClick={tile.onClick} className="text-left">
            {body}
          </button>
        ) : (
          <div>{body}</div>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tile.hint}
        {interactive && <span className="text-muted-foreground mt-1 block">Click to filter.</span>}
      </TooltipContent>
    </Tooltip>
  )
}
