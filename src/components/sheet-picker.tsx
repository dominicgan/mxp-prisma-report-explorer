import { CheckIcon, FileSpreadsheetIcon, HistoryIcon, SheetIcon, TriangleAlertIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { num } from '@/lib/format'
import type { SheetInfo } from '@/lib/parse'
import type { Recall } from '@/lib/sheet-prefs'
import { cn } from '@/lib/utils'

export function SheetPicker({
  fileName,
  sheets,
  recalled,
  defaultSheet,
  onChoose,
  onCancel,
}: {
  fileName: string
  sheets: SheetInfo[]
  recalled: Recall | null
  defaultSheet?: string
  onChoose: (sheetName: string, remember: boolean) => void
  onCancel: () => void
}) {
  const initial = recalled?.sheetName ?? defaultSheet ?? sheets[0]?.name
  const [selected, setSelected] = useState(initial)
  const [remember, setRemember] = useState(true)

  const chosen = sheets.find((s) => s.name === selected)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center p-6">
      <div className="mb-5">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <FileSpreadsheetIcon className="size-3.5" />
          <span className="truncate">{fileName}</span>
        </div>
        <h1 className="mt-2 text-lg font-semibold">
          This workbook has {sheets.length} sheets
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick the one holding the vulnerability export. Column counts below are how many headers match the
          Prisma schema, so the right sheet is usually obvious.
        </p>
      </div>

      {recalled?.source === 'name' && (
        <div className="bg-muted/60 mb-3 flex items-start gap-2 rounded-md border p-2.5 text-xs">
          <HistoryIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            You picked a sheet named <span className="font-medium">{recalled.sheetName}</span> before, so it is
            pre-selected here. This is a different file, so confirm it is still the right one.
          </span>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <ScrollArea className="max-h-[50vh]">
          <div className="divide-border divide-y">
            {sheets.map((s) => (
              <SheetRow
                key={s.name}
                sheet={s}
                selected={s.name === selected}
                remembered={recalled?.sheetName === s.name}
                onSelect={() => setSelected(s.name)}
                onConfirm={() => onChoose(s.name, remember)}
              />
            ))}
          </div>
        </ScrollArea>
      </Card>

      {chosen && !chosen.looksLikeReport && (
        <div className="border-sev-high/40 bg-sev-high/10 mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs">
          <TriangleAlertIcon className="text-sev-high mt-0.5 size-3.5 shrink-0" />
          <span>
            <span className="font-medium">{chosen.name}</span> does not look like a Prisma export - only{' '}
            {chosen.mappedColumns} of its columns match the schema. You can still load it, but most of the
            dashboard will be empty.
          </span>
        </div>
      )}

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
        <span>
          Remember this choice for this file
          <span className="text-muted-foreground">
            {' '}
            - re-uploading the identical workbook will skip this step
          </span>
        </span>
      </label>

      <div className="mt-4 flex gap-2">
        <Button size="sm" disabled={!selected} onClick={() => selected && onChoose(selected, remember)}>
          Load {selected ? `"${selected}"` : 'sheet'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Choose a different file
        </Button>
      </div>
    </div>
  )
}

function SheetRow({
  sheet,
  selected,
  remembered,
  onSelect,
  onConfirm,
}: {
  sheet: SheetInfo
  selected: boolean
  remembered: boolean
  onSelect: () => void
  onConfirm: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onConfirm}
      className={cn(
        'hover:bg-accent/60 flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
        selected && 'bg-accent',
      )}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        {selected && <CheckIcon className="size-3" />}
      </span>

      <SheetIcon className="text-muted-foreground size-4 shrink-0" />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{sheet.name}</span>
          {remembered && (
            <Badge variant="secondary" className="shrink-0 gap-1 font-normal">
              <HistoryIcon className="size-2.5" />
              Remembered
            </Badge>
          )}
          {sheet.looksLikeReport ? (
            <Badge variant="outline" className="border-sev-low/40 bg-sev-low/15 text-sev-low shrink-0">
              Prisma export
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground shrink-0 font-normal">
              Unrecognised
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
          {sheet.rowCount === 0 ? (
            'Empty sheet'
          ) : (
            <>
              ~{num(sheet.dataRowEstimate)} data rows &middot; {num(sheet.columnCount)} columns &middot;{' '}
              <span className={sheet.mappedColumns > 0 ? 'text-foreground' : undefined}>
                {sheet.mappedColumns} recognised
              </span>
              {sheet.headerRowIndex > 0 && <> &middot; header on row {sheet.headerRowIndex + 1}</>}
            </>
          )}
        </span>
      </span>
    </button>
  )
}
