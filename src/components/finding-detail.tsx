import { ExternalLinkIcon } from 'lucide-react'
import { CveLink, PatchBadge, SeverityBadge, SurfaceBadge, FlagBadge } from '@/components/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { CVE_SOURCES, isCve } from '@/lib/cve'
import { cvss as fmtCvss, date as fmtDate, dateTime } from '@/lib/format'
import type { Finding } from '@/lib/parse'
import { FIELDS, type FieldDef } from '@/lib/schema'

const GROUP_ORDER: FieldDef['group'][] = ['Finding', 'Location', 'Package', 'Lifecycle', 'Business', 'Ownership']

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,140px)_1fr] items-start gap-3 py-1 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

function valueFor(r: Finding, f: FieldDef) {
  const v = r[f.key]
  if (v == null || v === '') return null
  if (f.kind === 'date') return f.key === 'scanTime' || f.key === 'initialNotification' ? dateTime(v) : fmtDate(v)
  if (f.key === 'cvss') return fmtCvss(v)
  return String(v)
}

export function FindingDetail({
  finding,
  cveSource,
  onClose,
  onFilterBy,
}: {
  finding: Finding | null
  cveSource: string
  onClose: () => void
  onFilterBy?: (key: string, value: string) => void
}) {
  if (!finding) return null
  const cve = String(finding.cve ?? '')

  return (
    <Sheet open={Boolean(finding)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <SurfaceBadge surface={finding.surface} reason={finding.surfaceReason} />
            <FlagBadge value={finding.exploitable} yesLabel="Exploitable" noLabel="Not exploitable" />
            <PatchBadge value={finding.patchable} />
            {finding.cvss != null && (
              <Badge variant="secondary" className="tabular-nums">
                CVSS {fmtCvss(finding.cvss)}
              </Badge>
            )}
          </div>
          <SheetTitle className="mt-1 font-mono text-sm break-all">
            {cve || String(finding.bulletin ?? 'Finding')}
          </SheetTitle>
          <SheetDescription className="break-all">
            {String(finding.packageName ?? '')} {String(finding.packageVersion ?? '')}
            {finding.repo ? ` in ${finding.repo}` : ''}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {isCve(cve) && (
              <section>
                <h3 className="mb-2 text-xs font-semibold">Look up this CVE</h3>
                <div className="flex flex-wrap gap-1.5">
                  {CVE_SOURCES.map((s) => (
                    <Button key={s.id} variant="outline" size="xs" asChild title={s.hint}>
                      <a href={s.url(cve)} target="_blank" rel="noreferrer noopener">
                        {s.label}
                        <ExternalLinkIcon className="size-3 opacity-60" />
                      </a>
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {Boolean(finding.description) && (
              <section>
                <h3 className="mb-1 text-xs font-semibold">Description</h3>
                <p className="text-muted-foreground text-xs leading-relaxed break-words">
                  {String(finding.description)}
                </p>
              </section>
            )}

            {Boolean(finding.status) && (
              <section>
                <h3 className="mb-1 text-xs font-semibold">Remediation</h3>
                <p className="text-xs leading-relaxed break-words">{String(finding.status)}</p>
                {Boolean(finding.fixDate) && (
                  <p className="text-muted-foreground mt-1 text-xs">Fix published {fmtDate(finding.fixDate)}</p>
                )}
              </section>
            )}

            {Boolean(finding.tagStream) && (
              <section>
                <h3 className="mb-1 text-xs font-semibold">Image tag</h3>
                <div className="divide-border/60 divide-y">
                  <Row label="Branch / stream">
                    {onFilterBy ? (
                      <button
                        type="button"
                        onClick={() => onFilterBy('tagStream', String(finding.tagStream))}
                        className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                        title={`Filter to everything built from ${finding.tagStream}`}
                      >
                        {String(finding.tagStream)}
                      </button>
                    ) : (
                      String(finding.tagStream)
                    )}
                  </Row>
                  {Boolean(finding.tagVersion) && <Row label="Version">{String(finding.tagVersion)}</Row>}
                  {finding.tagBuild != null && <Row label="Build number">{String(finding.tagBuild)}</Row>}
                  {Boolean(finding.tagBuiltAt) && (
                    <Row label="Image built">
                      {dateTime(finding.tagBuiltAt)}
                      {finding.imageAgeDays != null && (
                        <span className="text-muted-foreground"> ({String(finding.imageAgeDays)} days ago)</span>
                      )}
                    </Row>
                  )}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-1 text-xs font-semibold">Why this surface</h3>
              <p className="text-muted-foreground text-xs">{String(finding.surfaceReason ?? 'Not classified')}</p>
            </section>

            <Separator />

            {GROUP_ORDER.map((g) => {
              const fields = FIELDS.filter((f) => f.group === g && valueFor(finding, f) != null)
              if (!fields.length) return null
              return (
                <section key={g}>
                  <h3 className="text-muted-foreground mb-1 text-[11px] font-semibold tracking-wide uppercase">{g}</h3>
                  <div className="divide-border/60 divide-y">
                    {fields.map((f) => {
                      const v = valueFor(finding, f)
                      const filterable = f.facet && onFilterBy && v
                      return (
                        <Row key={f.key} label={f.label}>
                          {f.key === 'cve' ? (
                            <CveLink cve={v} source={cveSource} preview={false} />
                          ) : filterable ? (
                            <button
                              type="button"
                              onClick={() => onFilterBy(f.key, v)}
                              className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid"
                              title={`Filter the whole report to ${f.label} = ${v}`}
                            >
                              {v}
                            </button>
                          ) : (
                            <span className={f.key === 'purl' || f.key === 'imageId' ? 'font-mono break-all' : ''}>
                              {v}
                            </span>
                          )}
                        </Row>
                      )
                    })}
                  </div>
                </section>
              )
            })}

            <p className="text-muted-foreground pt-2 text-[11px]">Source sheet row {String(finding.rowIndex)}</p>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
