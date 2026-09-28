import { BoxIcon, CheckIcon, CodeIcon, ExternalLinkIcon, HelpCircleIcon, MinusIcon, ZapIcon } from 'lucide-react'
import { CveHover, type LocalCveContext } from '@/components/cve-hover'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cveUrl, isCve } from '@/lib/cve'
import { cn } from '@/lib/utils'

const SEV_STYLE: Record<string, string> = {
  Critical: 'border-sev-critical/40 bg-sev-critical/15 text-sev-critical',
  High: 'border-sev-high/40 bg-sev-high/15 text-sev-high',
  Medium: 'border-sev-medium/40 bg-sev-medium/15 text-sev-medium',
  Low: 'border-sev-low/40 bg-sev-low/15 text-sev-low',
  Unknown: 'border-sev-none/40 bg-sev-none/15 text-sev-none',
}

/**
 * Severity always ships as colour + text. Status colours never carry meaning
 * alone, so the label is not optional.
 */
export function SeverityBadge({ severity, className }: { severity: unknown; className?: string }) {
  const s = String(severity ?? 'Unknown')
  return (
    <Badge variant="outline" className={cn('font-medium', SEV_STYLE[s] ?? SEV_STYLE.Unknown, className)}>
      {s}
    </Badge>
  )
}

/** Tri-state flag rendered as icon + word, so it reads without colour. */
export function FlagBadge({
  value,
  yesLabel,
  noLabel,
  tone = 'warn',
  className,
}: {
  value: unknown
  yesLabel: string
  noLabel: string
  tone?: 'warn' | 'good'
  className?: string
}) {
  const v = String(value ?? 'Unknown')
  if (v === 'Unknown') {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground gap-1 font-normal', className)}>
        <HelpCircleIcon className="size-3" />
        Unknown
      </Badge>
    )
  }
  const yes = v === 'Yes'
  const highlight = tone === 'warn' ? yes : !yes
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 font-medium',
        highlight ? 'border-sev-high/40 bg-sev-high/15 text-sev-high' : 'text-muted-foreground',
        className,
      )}
    >
      {yes ? <ZapIcon className="size-3" /> : <MinusIcon className="size-3" />}
      {yes ? yesLabel : noLabel}
    </Badge>
  )
}

export function PatchBadge({ value, className }: { value: unknown; className?: string }) {
  const v = String(value ?? 'Unknown')
  if (v === 'Unknown') {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground gap-1 font-normal', className)}>
        <HelpCircleIcon className="size-3" />
        Unknown
      </Badge>
    )
  }
  const yes = v === 'Yes'
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 font-medium',
        yes ? 'border-sev-low/40 bg-sev-low/15 text-sev-low' : 'text-muted-foreground',
        className,
      )}
    >
      {yes ? <CheckIcon className="size-3" /> : <MinusIcon className="size-3" />}
      {yes ? 'Patchable' : 'No patch'}
    </Badge>
  )
}

/** Container vs code, with the classification rationale on hover. */
export function SurfaceBadge({
  surface,
  reason,
  className,
}: {
  surface: unknown
  reason?: unknown
  className?: string
}) {
  const s = String(surface ?? 'Unknown')
  const Icon = s === 'Container' ? BoxIcon : s === 'Code' ? CodeIcon : HelpCircleIcon
  const badge = (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 font-medium',
        s === 'Container' && 'border-chart-2/40 bg-chart-2/15 text-chart-2',
        s === 'Code' && 'border-chart-1/40 bg-chart-1/15 text-chart-1',
        s === 'Unknown' && 'text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3" />
      {s}
    </Badge>
  )
  if (!reason) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{badge}</span>
      </TooltipTrigger>
      <TooltipContent>Classified as {s}: {String(reason)}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A CVE id links out to the chosen vulnerability database. Internal bulletin
 * ids have no public record, so they render as plain text rather than a dead link.
 */
export function CveLink({
  cve,
  source,
  className,
  showIcon = true,
  preview,
}: {
  cve: unknown
  source?: string
  className?: string
  showIcon?: boolean
  /** Row context for the hover card. Omit to render a plain link. */
  preview?: LocalCveContext | false
}) {
  const v = String(cve ?? '').trim()
  if (!v) return <span className="text-muted-foreground">-</span>
  if (!isCve(v)) return <span className={cn('font-mono text-xs', className)}>{v}</span>

  const link = (
    <a
      href={cveUrl(v, source)}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'text-foreground inline-flex items-center gap-1 font-mono text-xs underline decoration-dotted underline-offset-2 hover:decoration-solid',
        className,
      )}
    >
      {v}
      {showIcon && <ExternalLinkIcon className="size-3 shrink-0 opacity-60" />}
    </a>
  )

  if (preview === false || preview === undefined) return link
  return (
    <CveHover cve={v} source={source} local={preview}>
      {link}
    </CveHover>
  )
}
