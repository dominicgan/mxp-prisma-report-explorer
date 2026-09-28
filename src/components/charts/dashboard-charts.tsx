import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  axisProps,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
  foldToSlots,
  gridProps,
  SEVERITY_CONFIG,
} from '@/components/ui/chart'
import { num, pct, shortRepo } from '@/lib/format'
import type { Finding } from '@/lib/parse'
import { SEVERITY_ORDER } from '@/lib/schema'
import {
  ageBreakdown,
  countBy,
  discoveryTrend,
  exploitPatchMatrix,
  severityBreakdown,
  stackedBySeverity,
} from '@/lib/stats'
import { cn } from '@/lib/utils'

const SEV_KEYS = [...SEVERITY_ORDER]

/**
 * Recharts hands click handlers a shape whose `key` collides with React's own
 * `Key` type, so read the bucket key off the payload defensively instead of
 * destructuring it.
 */
function onBucketClick(fn?: (value: string) => void) {
  if (!fn) return undefined
  return (d: unknown) => {
    const rec = d as { key?: unknown; payload?: { key?: unknown } } | undefined
    const v = rec?.payload?.key ?? rec?.key
    if (typeof v === 'string') fn(v)
  }
}

/** A stacked bar leaves a 2px surface gap between segments, per the mark spec. */
const STACK_GAP = { stroke: 'var(--card)', strokeWidth: 2 }

function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  )
}

function EmptyPlot({ height = 220 }: { height?: number }) {
  return (
    <div className="text-muted-foreground flex items-center justify-center text-xs" style={{ height }}>
      No rows match the current filters
    </div>
  )
}

/** Severity split. Donut, because this is a part-to-whole with few slices. */
export function SeverityChart({ rows, onSelect }: { rows: Finding[]; onSelect?: (sev: string) => void }) {
  const data = severityBreakdown(rows).filter((d) => d.count > 0)
  const total = data.reduce((a, b) => a + b.count, 0)
  const present = data.map((d) => d.key)

  return (
    <ChartCard title="Severity" description={`${num(total)} findings`}>
      {!total ? (
        <EmptyPlot height={200} />
      ) : (
        <>
          {/* The centre figure is an HTML overlay rather than an SVG <Label>:
              it inherits the app's type tokens and is not subject to the
              chart library's label-layout rules. */}
          <div className="relative">
            <ChartContainer height={200}>
              <PieChart>
                <ChartTooltip config={SEVERITY_CONFIG} />
                <Pie
                  data={data}
                  dataKey="count"
                  nameKey="key"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={2}
                  strokeWidth={0}
                  onClick={onBucketClick(onSelect)}
                  className={onSelect ? 'cursor-pointer' : undefined}
                >
                  {data.map((d) => (
                    <Cell key={d.key} fill={SEVERITY_CONFIG[d.key]?.color ?? 'var(--sev-none)'} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl leading-none font-semibold tabular-nums">{num(total)}</span>
              <span className="text-muted-foreground mt-1 text-[11px]">findings</span>
            </div>
          </div>
          <ChartLegend config={SEVERITY_CONFIG} keys={present} className="mt-1 justify-center" onSelect={onSelect} />
          {/* Direct labels: identity is never carried by colour alone. */}
          <div className="text-muted-foreground mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
            {data.map((d) => (
              <div key={d.key} className="flex justify-between gap-2">
                <span>{d.key}</span>
                <span className="text-foreground font-medium">
                  {num(d.count)} <span className="text-muted-foreground font-normal">{pct(d.count, total)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </ChartCard>
  )
}

/** The triage 2x2: exploitable vs patchable. */
export function TriageMatrix({
  rows,
  onSelect,
}: {
  rows: Finding[]
  onSelect?: (exploitable: string, patchable: string) => void
}) {
  const { cells, axes } = exploitPatchMatrix(rows)
  const total = rows.length
  const max = Math.max(1, ...cells.map((c) => c.count))

  const cellAt = (e: string, p: string) => cells.find((c) => c.exploitable === e && c.patchable === p)?.count ?? 0

  // "Exploitable and patchable" is the actionable corner and is called out in
  // words, not by colour, so the meaning survives a greyscale print.
  const toneFor = (e: string, p: string) => {
    if (e === 'Yes' && p === 'Yes') return 'var(--sev-critical)'
    if (e === 'Yes') return 'var(--sev-high)'
    if (p === 'Yes') return 'var(--sev-low)'
    return 'var(--sev-none)'
  }

  return (
    <ChartCard title="Exploitable x Patchable" description="Where to spend the next sprint">
      {!total ? (
        <EmptyPlot height={200} />
      ) : (
        <div className="mt-1">
          <div
            className="grid gap-1 text-xs"
            style={{ gridTemplateColumns: `auto repeat(${axes.patchable.length}, minmax(0,1fr))` }}
          >
            <div />
            {axes.patchable.map((p) => (
              <div key={p} className="text-muted-foreground pb-1 text-center font-medium">
                Patchable: {p}
              </div>
            ))}
            {axes.exploitable.map((e) => (
              <FragmentRow
                key={e}
                label={`Exploitable: ${e}`}
                cells={axes.patchable.map((p) => {
                  const count = cellAt(e, p)
                  return {
                    key: p,
                    count,
                    tone: toneFor(e, p),
                    intensity: count / max,
                    onClick: onSelect ? () => onSelect(e, p) : undefined,
                    hint: `${e === 'Yes' ? 'Exploitable' : e === 'No' ? 'Not exploitable' : 'Exploitability unknown'}, ${
                      p === 'Yes' ? 'patch available' : p === 'No' ? 'no patch' : 'patch status unknown'
                    }`,
                    total,
                  }
                })}
              />
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-[11px] leading-relaxed">
            Top-left is the actionable corner: a working exploit path <em>and</em> a patch to apply. The
            bottom-right corner is the long tail you accept or mitigate by other means.
          </p>
        </div>
      )}
    </ChartCard>
  )
}

function FragmentRow({
  label,
  cells,
}: {
  label: string
  cells: {
    key: string
    count: number
    tone: string
    intensity: number
    onClick?: () => void
    hint: string
    total: number
  }[]
}) {
  return (
    <>
      <div className="text-muted-foreground flex items-center pr-2 text-right font-medium">{label}</div>
      {cells.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.onClick}
          disabled={!c.onClick}
          title={`${c.hint} - ${num(c.count)} findings`}
          className="group relative flex min-h-16 flex-col items-center justify-center rounded-md border p-2 transition-colors enabled:hover:border-ring disabled:cursor-default"
          style={{
            background: `color-mix(in oklab, ${c.tone} ${Math.round(12 + c.intensity * 45)}%, var(--card))`,
          }}
        >
          <span className="text-foreground text-base leading-none font-semibold tabular-nums">{num(c.count)}</span>
          <span className="text-muted-foreground mt-0.5 text-[10px] tabular-nums">{pct(c.count, c.total)}</span>
        </button>
      ))}
    </>
  )
}

/** Container vs code, split by severity. */
export function SurfaceChart({ rows }: { rows: Finding[] }) {
  const data = stackedBySeverity(rows, 'surface', 4)
  const present = SEV_KEYS.filter((k) => data.some((d) => (d[k as keyof typeof d] as number) > 0))

  return (
    <ChartCard title="Container vs Code" description="Which layer the vulnerability lives in">
      {!data.length ? (
        <EmptyPlot height={180} />
      ) : (
        <>
          <ChartContainer height={180}>
            <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 0 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} axisLine={false} />
              <YAxis type="category" dataKey="key" width={78} {...axisProps} axisLine={false} />
              <ChartTooltip config={SEVERITY_CONFIG} total />
              {present.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="s"
                  fill={SEVERITY_CONFIG[k].color}
                  {...STACK_GAP}
                  radius={i === present.length - 1 ? [0, 4, 4, 0] : 0}
                  barSize={26}
                />
              ))}
            </BarChart>
          </ChartContainer>
          <ChartLegend config={SEVERITY_CONFIG} keys={present} className="mt-1" />
        </>
      )}
    </ChartCard>
  )
}

/** Top repos by finding count, split by severity. */
export function RepoChart({ rows, onSelect }: { rows: Finding[]; onSelect?: (repo: string) => void }) {
  const data = stackedBySeverity(rows, 'repo', 12).map((d) => ({ ...d, short: shortRepo(d.key) }))
  // Repo names run long; truncate the tick so it cannot overflow the gutter.
  const tick = (v: string) => (v.length > 26 ? `${v.slice(0, 25)}\u2026` : v)
  const present = SEV_KEYS.filter((k) => data.some((d) => (d[k as keyof typeof d] as number) > 0))

  return (
    <ChartCard title="Top repositories" description="Highest finding counts, stacked by severity">
      {!data.length ? (
        <EmptyPlot height={300} />
      ) : (
        <>
          <ChartContainer height={Math.max(180, data.length * 26 + 30)}>
            <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 0 }}>
              <CartesianGrid {...gridProps} horizontal={false} vertical />
              <XAxis type="number" {...axisProps} axisLine={false} />
              <YAxis
                type="category"
                dataKey="short"
                width={186}
                {...axisProps}
                axisLine={false}
                interval={0}
                tickFormatter={tick}
              />
              <ChartTooltip config={SEVERITY_CONFIG} total />
              {present.map((k, i) => (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="s"
                  fill={SEVERITY_CONFIG[k].color}
                  {...STACK_GAP}
                  radius={i === present.length - 1 ? [0, 4, 4, 0] : 0}
                  barSize={18}
                  onClick={onBucketClick(onSelect)}
                  className={onSelect ? 'cursor-pointer' : undefined}
                />
              ))}
            </BarChart>
          </ChartContainer>
          <ChartLegend config={SEVERITY_CONFIG} keys={present} className="mt-1" />
        </>
      )}
    </ChartCard>
  )
}

/** A single-series count bar over an arbitrary dimension. */
export function DimensionChart({
  rows,
  dimension,
  title,
  description,
  onSelect,
  height = 200,
  topN = 10,
}: {
  rows: Finding[]
  dimension: string
  title: string
  description?: string
  onSelect?: (value: string) => void
  height?: number
  topN?: number
}) {
  // The tail folds into "Other" rather than being dropped, so the bars still
  // add up to the filtered total.
  const data = foldToSlots(countBy(rows, dimension), topN)
  // One measure, one colour: the category is already named on the y-axis, so
  // giving each bar its own hue would encode nothing.
  const config = { count: { label: 'Findings', color: 'var(--chart-1)' } }

  return (
    <ChartCard title={title} description={description}>
      {!data.length ? (
        <EmptyPlot height={height} />
      ) : (
        <ChartContainer height={height}>
          <BarChart data={data} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 0 }}>
            <CartesianGrid {...gridProps} horizontal={false} vertical />
            <XAxis type="number" {...axisProps} axisLine={false} />
            <YAxis
              type="category"
              dataKey="key"
              width={150}
              {...axisProps}
              axisLine={false}
              interval={0}
              tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}\u2026` : v)}
            />
            <ChartTooltip config={config} />
            <Bar
              dataKey="count"
              fill="var(--chart-1)"
              radius={[0, 4, 4, 0]}
              barSize={18}
              onClick={onBucketClick(onSelect)}
              className={onSelect ? 'cursor-pointer' : undefined}
            />
          </BarChart>
        </ChartContainer>
      )}
    </ChartCard>
  )
}

/** How long findings have been open. Ordered buckets, single measure. */
export function AgeChart({ rows }: { rows: Finding[] }) {
  const data = ageBreakdown(rows)
  const hasData = data.some((d) => d.count > 0)

  return (
    <ChartCard title="Age since discovery" description="How long these findings have been open">
      {!hasData ? (
        <EmptyPlot height={180} />
      ) : (
        <ChartContainer height={180}>
          <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="key" {...axisProps} axisLine={false} />
            <YAxis {...axisProps} axisLine={false} width={36} />
            <ChartTooltip config={{ count: { label: 'Findings', color: 'var(--chart-1)' } }} />
            <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} barSize={34} />
          </BarChart>
        </ChartContainer>
      )}
    </ChartCard>
  )
}

/** Discovery over time. Only meaningful once the export spans several days. */
export function TrendChart({ rows }: { rows: Finding[] }) {
  const data = discoveryTrend(rows)

  return (
    <ChartCard title="Discovery timeline" description="Findings by the date Prisma first saw them">
      {data.length < 2 ? (
        <div className="text-muted-foreground flex h-[180px] items-center justify-center px-4 text-center text-xs">
          {data.length === 1
            ? `All findings in view were discovered on ${data[0].date} - a timeline needs at least two distinct dates.`
            : 'No discovery dates in the current selection.'}
        </div>
      ) : (
        <ChartContainer height={180}>
          <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} axisLine={false} minTickGap={24} />
            <YAxis {...axisProps} axisLine={false} width={36} />
            <ChartTooltip config={{ count: { label: 'Discovered', color: 'var(--chart-1)' } }} />
            <Line
              type="monotone"
              dataKey="count"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: 'var(--chart-1)' }}
              activeDot={{ r: 5, stroke: 'var(--card)', strokeWidth: 2 }}
            />
          </LineChart>
        </ChartContainer>
      )}
    </ChartCard>
  )
}
