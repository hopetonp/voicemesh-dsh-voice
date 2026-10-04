/** Composer voice indicator that spells out the selection on hover, focus, or tap. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './VoiceQuickControls.module.css'

/** One labelled value shown inside the bubble. */
export interface SelectionTipRow {
  readonly label: string
  readonly value: string
}

/** Which side of the anchor the bubble asks for before the fit pass corrects it. */
export type SelectionTipSide = 'top' | 'bottom'

/** Gap kept between the bubble and the viewport edges. */
const EDGE_MARGIN = 12

/** Gap between the anchor and the bubble. */
const ANCHOR_GAP = 8

/**
 * Show what the voice surface is currently set to, from the indicator that is already on screen.
 *
 * The composer's voice row says how long the voice has been live and nothing about what is
 * speaking: the provider, the model, and the voice are only in the settings panel, and the
 * thinking level is a radio button there. This hangs the whole selection on the row's own status
 * indicator instead, so the answer is one hover, tap, or tab away while the voice is running.
 *
 * The three triggers end differently and are tracked separately: a mouse that leaves, a focus that
 * moves on, and a tap that stays until the reader taps away from it. The press is tracked apart
 * from the focus because a button focused by a press would otherwise open the bubble and close it
 * again inside the same tap.
 * @param props.summary - the anchor's own text; the host styles the anchor, this only labels it.
 * @param props.rows - labelled values shown in the bubble, in display order.
 * @param props.anchorClassName - classes for the anchor button, so the host keeps its own look.
 * @param props.side - requested placement; the fit pass flips it when that side has no room.
 * @param props.onOpenChange - reports visibility, so a host can load what a row needs lazily.
 * @param props.t - locale lookup for this plugin's dictionary.
 * @returns the anchor button and, while it is open, a fixed-position bubble.
 */
export function SelectionTip({ summary, rows, anchorClassName, side = 'top', onOpenChange, t }: PropsLocale<'voice'> & {
  summary: string
  rows: readonly SelectionTipRow[]
  anchorClassName: string
  side?: SelectionTipSide
  onOpenChange?: (open: boolean) => void
}): JSX.Element {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const bubble = useRef<HTMLSpanElement | null>(null)
  /** Whether the current focus came from a pointer, in which case activation owns the bubble. */
  const byPointer = useRef(false)
  const bubbleId = useId()
  const open = pinned || hovered
  // The rows arrive as a fresh array each render, so placement follows their content rather than
  // their identity: an unrelated re-render must not re-measure, and a changed value must.
  const rowsKey = rows.map(row => `${row.label}\u0000${row.value}`).join('\u0001')

  useEffect(() => { onOpenChange?.(open) }, [open, onOpenChange])

  // Fixed positioning knows nothing about the viewport edges: a bubble above an anchor near the top
  // would run off it, and one centered near a side edge would clip. So the requested place is
  // measured first and then corrected — flipped to the other side where this one does not fit,
  // slid back inside horizontally — and the measurement follows the view as it scrolls.
  useLayoutEffect(() => {
    if (!open) { setPlaced(null); return }
    const fit = (): void => {
      const el = anchor.current
      const tip = bubble.current
      if (el === null || tip === null) return
      const box = el.getBoundingClientRect()
      const size = tip.getBoundingClientRect()
      const below = box.bottom + ANCHOR_GAP
      const above = box.top - ANCHOR_GAP - size.height
      const fitsBelow = below + size.height <= window.innerHeight - EDGE_MARGIN
      const fitsAbove = above >= EDGE_MARGIN
      const top = side === 'bottom'
        ? fitsBelow || !fitsAbove ? below : above
        : fitsAbove || !fitsBelow ? above : below
      const centered = box.left + box.width / 2 - size.width / 2
      const left = Math.min(Math.max(centered, EDGE_MARGIN), Math.max(EDGE_MARGIN, window.innerWidth - EDGE_MARGIN - size.width))
      setPlaced(previous => previous !== null && previous.left === left && previous.top === top ? previous : { left, top })
    }
    fit()
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', fit, true)
    return () => {
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
    }
  }, [open, rowsKey, side])

  // A tap that opened the bubble has no pointer-leave to close it, so the next press anywhere else
  // is what dismisses it.
  useEffect(() => {
    if (!pinned) return
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target !== null && (anchor.current?.contains(target) === true || bubble.current?.contains(target) === true)) return
      setPinned(false)
    }
    document.addEventListener('pointerdown', onPress)
    return () => { document.removeEventListener('pointerdown', onPress) }
  }, [pinned])

  const close = useCallback((): void => { setPinned(false); setHovered(false) }, [])

  return <>
    <button
      ref={anchor}
      type="button"
      className={anchorClassName}
      aria-label={`${t('sts.selectionTip')}: ${summary}`}
      aria-expanded={open}
      {...open ? { 'aria-describedby': bubbleId } : {}}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHovered(true) }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHovered(false) }}
      onPointerDown={() => { byPointer.current = true }}
      onFocus={() => { if (!byPointer.current) setPinned(true) }}
      onBlur={() => { byPointer.current = false; close() }}
      onClick={() => { setPinned(value => !value) }}
      onKeyDown={(event) => { if (event.key === 'Escape') close() }}
    >
      {summary}
    </button>
    {open && <span
      ref={bubble}
      id={bubbleId}
      role="tooltip"
      className={css.tipBubble}
      style={{ left: placed?.left ?? 0, top: placed?.top ?? 0, visibility: placed === null ? 'hidden' : 'visible' }}
    >
      {rows.map(row => <span key={row.label} className={css.tipRow}>
        <span className={css.tipLabel}>{row.label}</span>
        <span className={css.tipValue}>{row.value}</span>
      </span>)}
    </span>}
  </>
}
