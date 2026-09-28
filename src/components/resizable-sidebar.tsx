import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'prisma-explorer.sidebar-width'
export const SIDEBAR_DEFAULT = 256
const MIN = 200
/** Beyond this the sidebar starts eating the charts rather than helping. */
const MAX = 720
/** Arrow-key step; Shift multiplies it. */
const STEP = 16

function clamp(n: number) {
  return Math.min(MAX, Math.max(MIN, Math.round(n)))
}

function readStored(): number {
  if (typeof localStorage === 'undefined') return SIDEBAR_DEFAULT
  const raw = Number(localStorage.getItem(STORAGE_KEY))
  return Number.isFinite(raw) && raw > 0 ? clamp(raw) : SIDEBAR_DEFAULT
}

/**
 * Sidebar with a draggable edge.
 *
 * Repo names, package paths and owner groups routinely run past any fixed
 * width, so the width is the user's to set and is remembered between sessions.
 */
export function ResizableSidebar({
  open,
  children,
  className,
}: {
  open: boolean
  children: React.ReactNode
  className?: string
}) {
  const [width, setWidth] = useState(readStored)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startW = useRef(0)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width))
  }, [width])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      startX.current = e.clientX
      startW.current = width
      setDragging(true)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      setWidth(clamp(startW.current + (e.clientX - startX.current)))
    },
    [dragging],
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 4 : STEP
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setWidth((w) => clamp(w - step))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setWidth((w) => clamp(w + step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setWidth(MIN)
    } else if (e.key === 'End') {
      e.preventDefault()
      setWidth(MAX)
    }
  }, [])

  // While dragging, keep the resize cursor and stop the pointer selecting text
  // as it passes over the facet list.
  useEffect(() => {
    if (!dragging) return
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [dragging])

  return (
    <div
      className={cn('relative flex shrink-0', !open && 'w-0 overflow-hidden', className)}
      style={open ? { width } : undefined}
    >
      <div className="min-w-0 flex-1 overflow-hidden">{children}</div>

      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize filters panel"
          aria-valuenow={width}
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          onDoubleClick={() => setWidth(SIDEBAR_DEFAULT)}
          title="Drag to resize · double-click to reset"
          className={cn(
            // A 1px border would be a miserable drag target, so the handle is a
            // wider invisible strip with a hairline drawn inside it.
            'group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none',
            'focus-visible:outline-none',
          )}
        >
          <div
            className={cn(
              'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors',
              'bg-border group-hover:bg-ring group-focus-visible:bg-ring',
              dragging && 'bg-ring',
            )}
          />
        </div>
      )}
    </div>
  )
}
