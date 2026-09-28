import type * as React from 'react'
import { ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { cn } from '@/lib/utils'

/** Maps a series key to its label and colour. */
export type ChartConfig = Record<string, { label: string; color: string }>

export function ChartContainer({
  className,
  height = 220,
  children,
}: {
  className?: string
  height?: number
  children: React.ReactElement
}) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}

/** Recessive axis/grid ink, per the chart-chrome spec. */
export const axisProps = {
  stroke: 'var(--chart-axis)',
  tick: { fill: 'var(--chart-ink-muted)', fontSize: 11 },
  tickLine: false,
} as const

export const gridProps = {
  stroke: 'var(--chart-grid)',
  strokeDasharray: '0',
  vertical: false,
} as const

interface TooltipPayloadItem {
  name?: string | number
  dataKey?: string | number
  value?: number | string
  color?: string
  payload?: Record<string, unknown>
}

function TooltipBody({
  label,
  payload,
  config,
  total,
  valueLabel,
}: {
  label?: React.ReactNode
  payload?: TooltipPayloadItem[]
  config?: ChartConfig
  total?: boolean
  valueLabel?: string
}) {
  if (!payload?.length) return null
  const items = payload.filter((p) => p.value !== 0 && p.value != null)
  if (!items.length) return null
  const sum = items.reduce((a, p) => a + (Number(p.value) || 0), 0)

  return (
    <div className="bg-popover text-popover-foreground rounded-md border px-2.5 py-2 text-xs shadow-md">
      {label != null && label !== '' && <div className="mb-1.5 font-medium break-all">{label}</div>}
      <div className="grid gap-1">
        {items.map((p, i) => {
          const key = String(p.dataKey ?? p.name ?? i)
          const conf = config?.[key]
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: conf?.color ?? p.color }}
                />
                <span className="text-muted-foreground">{conf?.label ?? key}</span>
              </span>
              <span className="font-medium tabular-nums">{Number(p.value).toLocaleString()}</span>
            </div>
          )
        })}
        {total && items.length > 1 && (
          <div className="mt-0.5 flex items-center justify-between gap-4 border-t pt-1">
            <span className="text-muted-foreground">{valueLabel ?? 'Total'}</span>
            <span className="font-medium tabular-nums">{sum.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function ChartTooltip({
  config,
  total,
  valueLabel,
  ...props
}: {
  config?: ChartConfig
  total?: boolean
  valueLabel?: string
} & Record<string, unknown>) {
  return (
    <RTooltip
      cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content={(p: any) => <TooltipBody {...p} config={config} total={total} valueLabel={valueLabel} />}
      {...props}
    />
  )
}

/**
 * Identity is never colour-alone: every multi-series chart renders this legend,
 * and single-series charts rely on the card title naming the measure.
 */
export function ChartLegend({
  config,
  keys,
  className,
  onSelect,
  activeKeys,
}: {
  config: ChartConfig
  keys: string[]
  className?: string
  onSelect?: (key: string) => void
  activeKeys?: Set<string>
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs', className)}>
      {keys.map((k) => {
        const c = config[k]
        if (!c) return null
        const dim = activeKeys && activeKeys.size > 0 && !activeKeys.has(k)
        const Tag = onSelect ? 'button' : 'span'
        return (
          <Tag
            key={k}
            {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(k) } : {})}
            className={cn(
              'flex items-center gap-1.5 transition-opacity',
              dim && 'opacity-40',
              onSelect && 'hover:opacity-80',
            )}
          >
            <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: c.color }} />
            <span className="text-muted-foreground">{c.label}</span>
          </Tag>
        )
      })}
    </div>
  )
}

export const SEVERITY_CONFIG: ChartConfig = {
  Critical: { label: 'Critical', color: 'var(--sev-critical)' },
  High: { label: 'High', color: 'var(--sev-high)' },
  Medium: { label: 'Medium', color: 'var(--sev-medium)' },
  Low: { label: 'Low', color: 'var(--sev-low)' },
  Unknown: { label: 'Unknown', color: 'var(--sev-none)' },
}

export const CATEGORICAL = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
] as const

/** Fixed slot order, never cycled: a 7th category folds into "Other". */
export function categoricalConfig(keys: string[]): ChartConfig {
  const cfg: ChartConfig = {}
  keys.slice(0, CATEGORICAL.length).forEach((k, i) => {
    cfg[k] = { label: k, color: CATEGORICAL[i] }
  })
  if (keys.length > CATEGORICAL.length) cfg.Other = { label: 'Other', color: 'var(--sev-none)' }
  return cfg
}

export function foldToSlots<T extends { key: string; count: number }>(buckets: T[], max: number = CATEGORICAL.length) {
  if (buckets.length <= max) return buckets
  const head = buckets.slice(0, max - 1)
  const tail = buckets.slice(max - 1)
  return [...head, { key: 'Other', count: tail.reduce((a, b) => a + b.count, 0) } as T]
}
