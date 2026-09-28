/// <reference lib="webworker" />
/**
 * Parsing runs here so a 30MB export does not freeze the tab.
 *
 * Measured on a real 91,578-row export: ~3s for the sheet-picker pass and ~21s
 * for the full parse. On the main thread that is 21s of dead UI; here the page
 * stays live and can show progress.
 *
 * The worker holds the file bytes for the session, so switching sheets does not
 * re-transfer 30MB across the boundary.
 */
import {
  inspectWorkbook,
  parseSheet,
  readWorkbookForPicker,
  readWorkbookSheet,
  type ReportMeta,
  type SheetChoice,
  type SheetInfo,
} from './parse'

export type WorkerRequest =
  | { id: number; kind: 'attach'; buffer: ArrayBuffer }
  | { id: number; kind: 'inspect'; buffer: ArrayBuffer }
  | { id: number; kind: 'parse'; fileName: string; sheetName: string; sheetChoice: SheetChoice }
  | { id: number; kind: 'release' }

export type WorkerResponse =
  | { id: number; kind: 'progress'; phase: string; pct: number | null }
  | { id: number; kind: 'attached' }
  | { id: number; kind: 'inspected'; sheets: SheetInfo[] }
  | { id: number; kind: 'parsed'; rows: Record<string, unknown>[]; meta: ReportMeta }
  | { id: number; kind: 'error'; message: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

let held: ArrayBuffer | null = null

function post(msg: WorkerResponse) {
  ctx.postMessage(msg)
}

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    switch (req.kind) {
      case 'attach': {
        // Take ownership of the bytes without reading them: used when a cached
        // report means we never needed to inspect, but a later sheet switch
        // still might.
        held = req.buffer
        post({ id: req.id, kind: 'attached' })
        return
      }
      case 'inspect': {
        held = req.buffer
        post({ id: req.id, kind: 'progress', phase: 'Reading workbook', pct: null })
        const sheets = inspectWorkbook(readWorkbookForPicker(held))
        post({ id: req.id, kind: 'inspected', sheets })
        return
      }
      case 'parse': {
        if (!held) throw new Error('No workbook loaded in the worker')
        post({ id: req.id, kind: 'progress', phase: `Reading sheet "${req.sheetName}"`, pct: null })
        const wb = readWorkbookSheet(held, req.sheetName)

        post({ id: req.id, kind: 'progress', phase: 'Building findings', pct: 0 })
        const { rows, meta } = parseSheet(wb, req.fileName, {
          sheetName: req.sheetName,
          sheetChoice: req.sheetChoice,
          onProgress: (done, total) =>
            post({ id: req.id, kind: 'progress', phase: 'Building findings', pct: done / total }),
        })
        post({ id: req.id, kind: 'parsed', rows: rows as unknown as Record<string, unknown>[], meta })
        return
      }
      case 'release': {
        held = null
        return
      }
    }
  } catch (err) {
    post({ id: req.id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
