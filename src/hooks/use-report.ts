import type { WorkBook } from 'xlsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodeFilters, encodeFilters, EMPTY_FILTERS, applyFilters, type FilterState } from '@/lib/filters'
import {
  inspectWorkbook,
  parseSheet,
  readWorkbook,
  type Finding,
  type ReportMeta,
  type SheetChoice,
  type SheetInfo,
} from '@/lib/parse'
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
}

const INITIAL: ReportState = {
  rows: [],
  meta: null,
  status: 'empty',
  sheets: [],
  fileKey: null,
  fileName: null,
  recalled: null,
}

const NO_ROWS_ERROR =
  'No data rows found on this sheet. It was read, but no row filled enough recognised columns - pick a different sheet, or check that this is the raw Prisma export.'

export function useReport() {
  const [state, setState] = useState<ReportState>(INITIAL)
  // The parsed workbook stays in memory so switching sheets is instant rather
  // than re-reading and re-inflating the file each time.
  const workbook = useRef<WorkBook | null>(null)

  const parseInto = useCallback(
    (wb: WorkBook, fileName: string, sheetName: string, sheetChoice: SheetChoice, sheets: SheetInfo[], key: string, recalled: Recall | null) => {
      try {
        const { rows, meta } = parseSheet(wb, fileName, { sheetName, sheetChoice })
        setState({
          rows,
          meta,
          status: rows.length ? 'ready' : 'error',
          error: rows.length ? undefined : NO_ROWS_ERROR,
          sheets,
          fileKey: key,
          fileName,
          recalled,
        })
      } catch (e) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        }))
      }
    },
    [],
  )

  const load = useCallback(
    async (file: File | Blob, fileName: string) => {
      setState({ ...INITIAL, status: 'loading', fileName })
      try {
        const buf = await file.arrayBuffer()
        // Yield a frame so the loading state actually paints before the
        // synchronous read blocks the thread.
        await new Promise((r) => requestAnimationFrame(() => r(null)))

        const key = await fileKey(buf)
        const wb = readWorkbook(buf)
        workbook.current = wb
        const sheets = inspectWorkbook(wb)

        if (sheets.length === 0) {
          setState({ ...INITIAL, status: 'error', error: 'That workbook has no sheets.', fileName })
          return
        }

        // A single-sheet workbook has nothing to choose.
        if (sheets.length === 1) {
          parseInto(wb, fileName, sheets[0].name, 'only-sheet', sheets, key, null)
          return
        }

        const recalled = recallSheet(key, sheets.map((s) => s.name))
        if (recalled?.source === 'file') {
          // An exact content match is a decision this user already made about
          // this exact file, so honour it without asking again.
          parseInto(wb, fileName, recalled.sheetName, 'remembered', sheets, key, recalled)
          return
        }

        // Otherwise ask, with the best guess pre-selected.
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
    [parseInto],
  )

  /** Commit a sheet choice from the picker. */
  const chooseSheet = useCallback(
    (sheetName: string, remember: boolean) => {
      const wb = workbook.current
      setState((s) => {
        if (!wb || !s.fileKey || !s.fileName) return s
        if (remember) rememberSheet(s.fileKey, sheetName)
        else forgetFile(s.fileKey)
        queueMicrotask(() => parseInto(wb, s.fileName!, sheetName, 'chosen', s.sheets, s.fileKey!, s.recalled))
        return { ...s, status: 'loading' }
      })
    },
    [parseInto],
  )

  /** Switch sheets after the fact, from the toolbar. Always updates the memory. */
  const switchSheet = useCallback(
    (sheetName: string) => {
      const wb = workbook.current
      setState((s) => {
        if (!wb || !s.fileKey || !s.fileName || sheetName === s.meta?.sheetName) return s
        rememberSheet(s.fileKey, sheetName)
        queueMicrotask(() => parseInto(wb, s.fileName!, sheetName, 'chosen', s.sheets, s.fileKey!, s.recalled))
        return { ...s, status: 'loading' }
      })
    },
    [parseInto],
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
    workbook.current = null
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

export function useFilteredRows(rows: Finding[], filters: FilterState): Finding[] {
  const debouncedQ = useDebounced(filters.q, 200)
  const effective = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ])
  return useMemo(() => applyFilters(rows, effective), [rows, effective])
}
