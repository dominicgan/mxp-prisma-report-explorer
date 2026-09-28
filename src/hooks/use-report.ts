import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodeFilters, encodeFilters, EMPTY_FILTERS, applyFilters, type FilterState } from '@/lib/filters'
import type { Finding, ReportMeta, SheetChoice, SheetInfo } from '@/lib/parse'
import { ParseClient, type Progress } from '@/lib/parse-client'
import { readCachedReport, writeCachedReport } from '@/lib/report-cache'
import { fileKey, forgetFile, recallSheet, rememberSheet, type Recall } from '@/lib/sheet-prefs'

export interface ReportState {
  rows: Finding[]
  meta: ReportMeta | null
  /** `choosing` means the workbook is open but no sheet has been picked yet. */
  status: 'empty' | 'loading' | 'choosing' | 'ready' | 'error'
  error?: string
  /** Every sheet in the open workbook, for the picker and the toolbar switcher. */
  sheets: SheetInfo[]
  /** Content key of the open file, used for the remembered-sheet store. */
  fileKey: string | null
  fileName: string | null
  /** Set when a sheet was pre-selected from a previous session. */
  recalled: Recall | null
  /** What the worker is doing right now, while status is 'loading'. */
  progress: Progress | null
  /** True when the rows came back from the cache rather than a fresh parse. */
  fromCache: boolean
}

const INITIAL: ReportState = {
  rows: [],
  meta: null,
  status: 'empty',
  sheets: [],
  fileKey: null,
  fileName: null,
  recalled: null,
  progress: null,
  fromCache: false,
}

const NO_ROWS_ERROR =
  'No data rows found on this sheet. It was read, but no row filled enough recognised columns - pick a different sheet, or check that this is the raw Prisma export.'

export function useReport() {
  const [state, setState] = useState<ReportState>(INITIAL)
  const client = useRef<ParseClient | null>(null)

  // Callbacks read the latest state through this instead of taking it as a
  // dependency, which would rebuild them on every progress tick.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const getClient = useCallback(() => {
    if (!client.current) client.current = new ParseClient()
    return client.current
  }, [])

  useEffect(() => () => client.current?.dispose(), [])

  const runParse = useCallback(
    async (
      fileName: string,
      sheetName: string,
      sheetChoice: SheetChoice,
      sheets: SheetInfo[],
      key: string,
      recalled: Recall | null,
    ) => {
      const settle = (rows: Finding[], meta: ReportMeta, fromCache: boolean) =>
        setState({
          rows,
          meta,
          status: rows.length ? 'ready' : 'error',
          error: rows.length ? undefined : NO_ROWS_ERROR,
          sheets,
          fileKey: key,
          fileName,
          recalled,
          progress: null,
          fromCache,
        })

      try {
        // A parsed copy of this exact file+sheet is ~20x cheaper to read back
        // than to re-derive.
        setState((s) => ({ ...s, status: 'loading', progress: { phase: 'Checking cache', pct: null } }))
        const cached = await readCachedReport(key, sheetName, (pct) =>
          setState((s) => (s.status === 'loading' ? { ...s, progress: { phase: 'Loading cached report', pct } } : s)),
        )
        if (cached) {
          settle(cached.rows, { ...cached.meta, sheetChoice }, true)
          return
        }

        const { rows, meta } = await getClient().parse(fileName, sheetName, sheetChoice, (progress) =>
          setState((s) => (s.status === 'loading' ? { ...s, progress } : s)),
        )
        settle(rows, meta, false)

        // Populate the cache after the report is on screen; a failure here is
        // invisible and only costs a re-parse next time.
        if (rows.length) void writeCachedReport(key, sheetName, rows, meta, sheets)
      } catch (e) {
        setState((s) => ({
          ...s,
          status: 'error',
          progress: null,
          error: e instanceof Error ? e.message : String(e),
        }))
      }
    },
    [getClient],
  )

  const load = useCallback(
    async (file: File | Blob, fileName: string) => {
      setState({ ...INITIAL, status: 'loading', fileName, progress: { phase: 'Reading file', pct: null } })
      try {
        const buf = await file.arrayBuffer()
        const key = await fileKey(buf)

        // Fast path: a sheet we already chose for this exact file, already
        // parsed and cached. Inspecting the workbook would cost ~3s to
        // rediscover something the cache already knows, so skip it and just
        // hand the bytes to the worker in case a later sheet switch needs them.
        const remembered = recallSheet(key, [])
        const rememberedName = remembered?.source === 'file' ? remembered.sheetName : undefined
        if (rememberedName) {
          setState((s) => ({ ...s, progress: { phase: 'Checking cache', pct: null } }))
          const hit = await readCachedReport(key, rememberedName, (pct) =>
            setState((s) => ({ ...s, progress: { phase: 'Loading cached report', pct } })),
          )
          if (hit && hit.sheets.length) {
            setState({
              rows: hit.rows,
              meta: { ...hit.meta, sheetChoice: 'remembered' },
              status: hit.rows.length ? 'ready' : 'error',
              error: hit.rows.length ? undefined : NO_ROWS_ERROR,
              sheets: hit.sheets,
              fileKey: key,
              fileName,
              recalled: remembered,
              progress: null,
              fromCache: true,
            })
            void getClient().attach(buf)
            return
          }
        }

        // fileKey read the bytes already; the worker takes ownership from here
        // (the buffer is transferred, so it is detached on this side).
        const sheets = await getClient().inspect(buf, (progress) =>
          setState((s) => (s.status === 'loading' ? { ...s, progress } : s)),
        )

        if (sheets.length === 0) {
          setState({ ...INITIAL, status: 'error', error: 'That workbook has no sheets.', fileName })
          return
        }

        if (sheets.length === 1) {
          await runParse(fileName, sheets[0].name, 'only-sheet', sheets, key, null)
          return
        }

        const recalled = recallSheet(key, sheets.map((s) => s.name))
        if (recalled?.source === 'file') {
          await runParse(fileName, recalled.sheetName, 'remembered', sheets, key, recalled)
          return
        }

        setState({ ...INITIAL, status: 'choosing', sheets, fileKey: key, fileName, recalled })
      } catch (e) {
        setState({
          ...INITIAL,
          status: 'error',
          fileName,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [getClient, runParse],
  )

  /** Commit a sheet choice from the picker. */
  const chooseSheet = useCallback(
    (sheetName: string, remember: boolean) => {
      const { fileKey: key, fileName, sheets, recalled } = stateRef.current
      if (!key || !fileName) return
      if (remember) rememberSheet(key, sheetName)
      else forgetFile(key)
      void runParse(fileName, sheetName, 'chosen', sheets, key, recalled)
    },
    [runParse],
  )

  /** Switch sheets after the fact, from the toolbar. Always updates the memory. */
  const switchSheet = useCallback(
    (sheetName: string) => {
      const { fileKey: key, fileName, sheets, recalled, meta } = stateRef.current
      if (!key || !fileName || sheetName === meta?.sheetName) return
      rememberSheet(key, sheetName)
      void runParse(fileName, sheetName, 'chosen', sheets, key, recalled)
    },
    [runParse],
  )

  /** Go back to the picker without dropping the loaded workbook. */
  const reopenPicker = useCallback(() => {
    setState((s) => (s.sheets.length > 1 ? { ...s, status: 'choosing', error: undefined } : s))
  }, [])

  /** Stop pre-selecting a sheet for this file next time. */
  const forgetChoice = useCallback(() => {
    setState((s) => {
      if (s.fileKey) forgetFile(s.fileKey)
      return { ...s, recalled: null }
    })
  }, [])

  const reset = useCallback(() => {
    client.current?.dispose()
    client.current = null
    setState(INITIAL)
  }, [])

  return { ...state, load, chooseSheet, switchSheet, reopenPicker, forgetChoice, reset }
}

/**
 * Filter state mirrored into the URL hash, so a filtered view is a link and
 * survives reload. The hash is the single source of truth on first paint.
 */
export function useFilters() {
  const [filters, setFilters] = useState<FilterState>(() =>
    typeof location === 'undefined' ? EMPTY_FILTERS : decodeFilters(location.hash.slice(1)),
  )

  useEffect(() => {
    const encoded = encodeFilters(filters)
    const next = encoded ? `#${encoded}` : ' '
    if (location.hash.slice(1) !== encoded) history.replaceState(null, '', next)
  }, [filters])

  useEffect(() => {
    const onPop = () => setFilters(decodeFilters(location.hash.slice(1)))
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  const clearAll = useCallback(() => setFilters(EMPTY_FILTERS), [])
  return { filters, setFilters, clearAll }
}

/** Debounced so typing in the search box doesn't refilter on every keystroke. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * The filter state everything *expensive* should read: identical to the live
 * state except the search box lags by one debounce interval.
 *
 * Keep this separate from the live state - anything that mutates filters must
 * start from the live copy, or a keystroke in flight gets clobbered by a stale
 * `q`.
 */
export function useEffectiveFilters(filters: FilterState): FilterState {
  const debouncedQ = useDebounced(filters.q, 200)
  return useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ])
}

export function useFilteredRows(rows: Finding[], effective: FilterState): Finding[] {
  return useMemo(() => applyFilters(rows, effective), [rows, effective])
}
