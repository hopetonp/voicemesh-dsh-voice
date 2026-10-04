/**
 * MicDock: the voice control, inside the message area.
 *
 * One round button, seated where the composer's Send control sits while the
 * draft is empty: it starts voice when off and stops it when on, and the icon
 * says which. Everything else the live loop needs — the elapsed clock, the
 * pause/resume pair, and mute — lives in the tool row beside the waveform
 * (`VoiceQuickControls`), so the whole voice surface stays in the composer and
 * there is no second, floating layout to keep in step.
 *
 * Hovering the button names the action while the voice is off; once the voice
 * is live the button carries no label of its own.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { phaseColor } from './state.ts'
import { Glyph } from './glyphs.tsx'
import type { MicDockActions } from './slots.ts'
import css from './MicDock.module.css'

/**
 * The live fill is the composer's send hue, exactly as Send wears it, in both
 * themes; only the hover lifts it (a lighter step of the same hue, since the
 * theme's own hover token goes darker). A muted or failed session carries its
 * own signal colour through the same variable, and only the inactive button
 * differs per theme (black in dark mode).
 */
const LIVE_FILL = 'var(--dsw-alias-button-info-fill)'
const LIVE_HOVER = 'color-mix(in srgb, var(--dsw-alias-button-info-fill) 80%, white)'

/** Full props of the composer entry: session share + injected verbs + the locale seat. */
export type MicDockProps =
  // The overlay's runtime props carry the session for the primary-action replacement and the
  // headless dock entry that stops a session's voice.
  Pick<import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>, 'sessionId'>
  & MicDockActions
  & PropsLocale<'voice'>

/** The voice control: a round button in the composer's primary-action position. */
export function MicDock({ sessionId, onToggle, onStop, sources, t }: MicDockProps) {
  const voice = useSyncExternalStore(sources.voice.subscribe, sources.voice.getSnapshot)
  const config = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const [busy, setBusy] = useState(false)

  const phase = voice.phase
  const error = voice.error
  const muted = config.muted
  // A failed activation is over, not live: its session was torn down, so the button offers a new start
  // instead of only a stop. Treating it as live left the control stuck on the failure until a reload.
  const active = phase !== 'idle' && phase !== 'error'
  const connecting = phase === 'connecting'
  // Muting paints the button red. Otherwise, idle stays the neutral surface (off
  // is obvious) and connecting stays neutral while the icon animates. Pulsing
  // (the level swell) is reserved for genuinely live states.
  const lit = muted || (active && phase !== 'connecting')
  const pulsing = active && lit && !connecting && phase !== 'standby'
  const color = muted ? 'var(--dsw-alias-state-error-primary, #c2544d)' : phaseColor(phase, error)
  // Voice that is on wears the (darkened) send hue in every live state, standby
  // included: parking the voice changes what the tool row offers, not how the
  // voice control looks. Muted and failed states keep their own signal colors.
  const live = lit && !muted && error === null
  const fill = live ? LIVE_FILL : color
  const hoverFill = live ? LIVE_HOVER : color
  // The icon says what the button does: a cross while the voice is connected —
  // standby included, since the control still stops the voice and resuming
  // belongs to the tool row's resume button — the moving bars while the
  // connection opens, and the crossed mic when muted.
  const glyph = error !== null ? 'warn' : muted ? 'mic-off' : connecting ? 'wave' : active ? 'stop' : 'wave'
  const scale = pulsing ? 1 + voice.level * 0.08 : 1
  // The hover hint belongs to the button only while the voice is off: it names
  // the action ("Start voice chat"), or carries a leftover failure. A live
  // button shows no status label — the tool row already says what is happening.
  const hint = active ? null : error !== null ? `${t('mic.err')}: ${error}` : t('status.idle')


  const onClick = (): void => {
    // The cross means stop in every live state, standby included; the tool row
    // owns resuming a parked voice.
    if (active) {
      onStop(sessionId)
    } else {
      if (busy) return
      setBusy(true)
      Promise.resolve(onToggle(sessionId)).finally(() => setBusy(false))
    }
  }

  return <div className={css.controls}>
    <button
      type="button"
      className={`${css.control}${lit ? ` ${css.lit}` : ''}${connecting ? ` ${css.connecting}` : ''}`}
      onClick={onClick}
      style={{ ['--voice-fill' as string]: fill, ['--voice-hover' as string]: hoverFill }}
      aria-pressed={active}
      aria-label={active ? t('mic.stop') : t('mic.off')}
    >
      <span className={css.glyph} style={{ color: lit || connecting ? '#fff' : 'var(--dsw-alias-label-secondary)', transform: `scale(${scale})` }}>
        <Glyph name={glyph} size={18} />
      </span>
    </button>
    {hint === null ? null : <span className={css.hint} role="tooltip">{hint}</span>}
  </div>
}

interface PrimaryAction {
  left: number
  top: number
  width: number
  height: number
}

/**
 * VoiceMesh's compatibility overlay for the current composer primary action.
 *
 * The published overlay slot supplies a stable mount inside the composer card. The primary action
 * itself is not a published slot, so this deliberately treats the current last button as an
 * optional visual anchor: any missing or unfamiliar state leaves the Harness control untouched.
 */
export function MicDockOverlay(props: MicDockProps) {
  const root = useRef<HTMLDivElement>(null)
  const [action, setAction] = useState<PrimaryAction | null>(null)

  useLayoutEffect(() => {
    const overlay = root.current
    if (overlay === null) return
    const card = overlay.closest<HTMLElement>('[data-composer-card]')
    if (card === null) return

    let hidden: HTMLButtonElement | undefined
    let priorVisibility = ''
    let priorAriaHidden: string | null = null
    let priorTabIndex: string | null = null
    let resizeObserver: ResizeObserver | undefined
    let stopTracking: (() => void) | undefined
    const restore = () => {
      stopTracking?.()
      stopTracking = undefined
      if (hidden === undefined) return
      hidden.style.visibility = priorVisibility
      if (priorAriaHidden === null) hidden.removeAttribute('aria-hidden')
      else hidden.setAttribute('aria-hidden', priorAriaHidden)
      if (priorTabIndex === null) hidden.removeAttribute('tabindex')
      else hidden.setAttribute('tabindex', priorTabIndex)
      hidden = undefined
    }
    const locate = (): void => {
      restore()
      const editor = card.querySelector<HTMLElement>('[contenteditable="true"]')
      const attachments = card.querySelector('[data-slot="conversation.input.attachments"]')
      const buttons = card.querySelectorAll<HTMLButtonElement>('button')
      const target = buttons.item(buttons.length - 1)
      // Empty Send is disabled by the composer itself. A noneditable editor identifies locked,
      // inert, and busy states; a rendered attachment means Send must remain available.
      if (editor === null || editor.textContent?.trim() !== ''
        || (attachments !== null && attachments.childElementCount !== 0)
        || target === null || target.querySelector('svg rect') !== null) {
        setAction(null)
        return
      }
      priorVisibility = target.style.visibility
      priorAriaHidden = target.getAttribute('aria-hidden')
      priorTabIndex = target.getAttribute('tabindex')
      target.style.visibility = 'hidden'
      target.setAttribute('aria-hidden', 'true')
      target.setAttribute('tabindex', '-1')
      hidden = target
      const place = () => {
        if (hidden !== target) return
        const cardRect = card.getBoundingClientRect()
        const rect = target.getBoundingClientRect()
        const next = { left: rect.left - cardRect.left, top: rect.top - cardRect.top, width: rect.width, height: rect.height }
        setAction(current => current !== null && current.left === next.left && current.top === next.top
          && current.width === next.width && current.height === next.height ? current : next)
      }
      place()
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(place)
        resizeObserver.observe(card)
        if (target.parentElement !== null) resizeObserver.observe(target.parentElement)
      }
      window.addEventListener('resize', place)
      stopTracking = () => {
        window.removeEventListener('resize', place)
        resizeObserver?.disconnect()
      }
    }
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(card, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['contenteditable', 'disabled'],
    })
    return () => { observer.disconnect(); restore() }
  }, [])

  if (action === null) return <div ref={root} className={css.overlay} />
  return (
    <div ref={root} className={css.overlay} style={{ left: action.left, top: action.top + 2, width: action.width, height: action.height }}>
      <MicDock {...props} />
    </div>
  )
}

/**
 * Session-lifetime guard: a headless entry in the composer's dock strip.
 *
 * The voice control itself is mounted only while the draft is empty, so it
 * cannot own the rule that a session's voice goes away with the session —
 * typing must never stop voice. This entry renders nothing and stops voice when
 * the session it was mounted for goes away, keeping sts voice from outliving
 * its session while the control comes and goes with the draft.
 */
export function VoiceSessionGuard({ sessionId, onStop, sources }: MicDockProps): null {
  const config = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const latestStop = useRef(onStop)
  latestStop.current = onStop
  useEffect(() => {
    if (config.voiceMode !== 'sts') return
    return () => { latestStop.current(sessionId) }
  }, [sessionId, config.voiceMode])
  return null
}
