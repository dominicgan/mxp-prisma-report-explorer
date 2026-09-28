import type { Finding, ReportMeta, SheetChoice, SheetInfo } from './parse'
import type { WorkerRequest, WorkerResponse } from './parse.worker'

export interface Progress {
  phase: string
  /** 0..1, or null when the phase has no measurable progress. */
  pct: number | null
}

/** Omit that distributes over a union, so each request variant keeps its shape. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

type Pending = {
  resolve: (v: never) => void
  reject: (e: Error) => void
  onProgress?: (p: Progress) => void
}

/**
 * Main-thread handle on the parsing worker.
 *
 * One worker per report. It keeps the file bytes, so switching sheets is a
 * small message rather than another 30MB transfer.
 */
export class ParseClient {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending>()

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      const p = this.pending.get(msg.id)
      if (!p) return
      if (msg.kind === 'progress') {
        p.onProgress?.({ phase: msg.phase, pct: msg.pct })
        return
      }
      this.pending.delete(msg.id)
      if (msg.kind === 'error') p.reject(new Error(msg.message))
      else p.resolve(msg as never)
    }
    w.onerror = (e) => {
      const err = new Error(e.message || 'Parsing worker failed')
      for (const [, p] of this.pending) p.reject(err)
      this.pending.clear()
    }
    this.worker = w
    return w
  }

  private send<T extends WorkerResponse>(
    req: DistOmit<WorkerRequest, 'id'>,
    transfer: Transferable[] = [],
    onProgress?: (p: Progress) => void,
  ): Promise<T> {
    const w = this.ensure()
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject, onProgress })
      w.postMessage({ ...req, id } as WorkerRequest, transfer)
    })
  }

  /** Hand the bytes over without reading them. Transfers (and detaches) the buffer. */
  async attach(buffer: ArrayBuffer): Promise<void> {
    await this.send<Extract<WorkerResponse, { kind: 'attached' }>>({ kind: 'attach', buffer }, [buffer])
  }

  /**
   * Hand the file to the worker and get the sheet summaries back.
   * The buffer is transferred, so it is detached on this side afterwards - the
   * worker owns it from here.
   */
  async inspect(buffer: ArrayBuffer, onProgress?: (p: Progress) => void): Promise<SheetInfo[]> {
    const res = await this.send<Extract<WorkerResponse, { kind: 'inspected' }>>(
      { kind: 'inspect', buffer },
      [buffer],
      onProgress,
    )
    return res.sheets
  }

  async parse(
    fileName: string,
    sheetName: string,
    sheetChoice: SheetChoice,
    onProgress?: (p: Progress) => void,
  ): Promise<{ rows: Finding[]; meta: ReportMeta }> {
    const res = await this.send<Extract<WorkerResponse, { kind: 'parsed' }>>(
      { kind: 'parse', fileName, sheetName, sheetChoice },
      [],
      onProgress,
    )
    return { rows: res.rows as unknown as Finding[], meta: res.meta }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }
}
