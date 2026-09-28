import { FileSpreadsheetIcon, LoaderCircleIcon, ShieldIcon, UploadIcon } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const ACCEPT = '.xlsx,.xlsm,.xls,.csv'

export function UploadZone({
  onFile,
  status,
  error,
  onLoadSample,
  onBackToSheets,
}: {
  onFile: (file: File) => void
  status: 'empty' | 'loading' | 'choosing' | 'ready' | 'error'
  error?: string
  onLoadSample?: () => void
  /** Offered when the failure was "wrong sheet" and the workbook is still open. */
  onBackToSheets?: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0]
      if (f) onFile(f)
    },
    [onFile],
  )

  const busy = status === 'loading'

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center p-6">
      <div className="mb-6 text-center">
        <div className="bg-muted mx-auto mb-3 flex size-11 items-center justify-center rounded-xl">
          <ShieldIcon className="size-5" />
        </div>
        <h1 className="text-xl font-semibold">Prisma Report Explorer</h1>
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-md text-sm">
          Drop a Prisma Cloud vulnerability export in and get a filterable dashboard. The file is parsed in your
          browser and never uploaded anywhere.
        </p>
      </div>

      <Card
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          'flex flex-col items-center justify-center border-2 border-dashed p-10 transition-colors',
          dragging && 'border-ring bg-accent/50',
          busy && 'opacity-70',
        )}
      >
        {busy ? (
          <LoaderCircleIcon className="text-muted-foreground size-7 animate-spin" />
        ) : (
          <FileSpreadsheetIcon className="text-muted-foreground size-7" />
        )}
        <p className="mt-3 text-sm font-medium">{busy ? 'Parsing workbook…' : 'Drop your export here'}</p>
        <p className="text-muted-foreground mt-1 text-xs">.xlsx, .xlsm, .xls or .csv</p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div className="mt-4 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <UploadIcon />
            Choose file
          </Button>
          {onLoadSample && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onLoadSample}>
              Load sample
            </Button>
          )}
        </div>
      </Card>

      {error && (
        <div className="border-destructive/40 bg-destructive/10 text-destructive mt-4 rounded-md border p-3 text-xs">
          {error}
          {onBackToSheets && (
            <Button variant="outline" size="xs" className="mt-2 flex" onClick={onBackToSheets}>
              Pick a different sheet
            </Button>
          )}
        </div>
      )}

      <div className="text-muted-foreground mt-6 space-y-1.5 text-xs">
        <p className="text-foreground font-medium">What it reads</p>
        <p>
          Columns are matched by header name, not position, so a re-export with reordered or renamed-in-case
          columns lands on the same dashboard. The <code className="text-foreground">Total</code> and{' '}
          <code className="text-foreground">Applied filters</code> footer rows are recognised and kept out of the
          data, and date columns are decoded in UTC so they never shift by a day.
        </p>
      </div>
    </div>
  )
}
