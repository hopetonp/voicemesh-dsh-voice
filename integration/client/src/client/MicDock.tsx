/**
 * MicDock: the voice control.
 *
 * Mirrors the Flutter voice control: a fixed column at the bottom-right with a
 * round conversation orb, a status panel that floats above it on hover, a
 * separate action menu beneath it (mute + read back output) that is revealed on
 * hover, and a live active-time clock that shows only while the voice is active.
 *
 * The orb is the one thing always visible. The hover panels (status, menu) and
 * the active timer never reflow the dock: the menu and timer occupy fixed-height
 * slots that are simply transparent when empty, so the orb's position is
 * constant — the Flutter contract ("the orb's resting position is unchanged").
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { phaseColor, phaseLabel, formatDuration, isActivePhase } from './state.ts'
import { Glyph, GlyphMic, GlyphMicOff } from './glyphs.tsx'
import type { MicDockActions } from './slots.ts'
import css from './MicDock.module.css'

/** Full props of the dock entry: InputZone owner share + injected verbs + the locale seat. */
export type MicDockProps =
  Pick<import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>, 'sessionId'>
  & MicDockActions
  & PropsLocale<'voice'>
  & { placement?: 'orb' | 'panel' }

/** The dock adapter: a stable orb backed by the injected verbs + stores. */
export function MicDock({ sessionId, onToggle, onStop, onMute, sources, t, placement = 'orb' }: MicDockProps) {
  const voice = useSyncExternalStore(sources.voice.subscribe, sources.voice.getSnapshot)
  const config = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const supported = useSyncExternalStore(sources.panelSupport?.subscribe ?? subscribeNoPanel, sources.panelSupport?.getSnapshot ?? noPanel)
  const [hover, setHover] = useState(false)
  const [busy, setBusy] = useState(false)
  const latestStop = useRef(onStop)
  latestStop.current = onStop
  useEffect(() => {
    if (placement !== 'orb' || config.voiceMode !== 'sts') return
    return () => { latestStop.current(sessionId) }
  }, [sessionId, config.voiceMode, placement])

  const phase = voice.phase
  const error = voice.error
  const muted = config.muted
  const active = phase !== 'idle'
  const connecting = phase === 'connecting'
  // Muting paints both layouts red. Otherwise, idle stays the neutral surface
  // (off is obvious); connecting stays neutral while the icon animates;
  // standby dims the listening color so it reads as parked, distinct from off.
  // Pulsing (the breathing halo) is reserved for genuinely live states.
  const lit = muted || (active && phase !== 'connecting')
  const pulsing = active && lit && !connecting && phase !== 'standby'
  const clockActive = isActivePhase(phase)
  const color = muted ? 'var(--dsw-alias-state-error-primary, #c2544d)' : phaseColor(phase, error)
  // The five-bar voice glyph flips to a
  // crossed mic when muted and to a warning when the loop errored.
  const glyph = muted ? 'mic-off' : error !== null ? 'warn' : 'wave'
  const scale = pulsing ? 1 + voice.level * 0.08 : 1
  const statusLabel = error !== null ? `${t('mic.err')}: ${error}` : phase === 'idle' ? t('status.idle') : phaseLabel(phase, error)

  const onClick = (): void => {
    // Tapping while parked (standby) wakes the loop back to listening — it must
    // not turn voice off. Matches the Flutter control ("tap to resume").
    if (phase === 'standby') {
      onToggle(sessionId)
      return
    }
    if (active) {
      onStop(sessionId)
    } else {
      if (busy) return
      setBusy(true)
      Promise.resolve(onToggle(sessionId)).finally(() => setBusy(false))
    }
  }

  const inPanel = config.controlLayout === 'panel' && supported
  if ((placement === 'panel') !== inPanel) return null
  if (placement === 'panel') return <div className={css.inlineControls} style={{ ['--voice-color' as string]: color }}>
    <button type="button" className={`${css.orb} ${css.inlineButton} ${css.inlinePrimary}${lit ? ` ${css.lit}` : ''}${connecting ? ` ${css.connecting}` : ''}${pulsing ? ` ${css.inlinePulse}` : ''}`} onClick={onClick}
      style={{ backgroundColor: lit ? color : undefined }}
      aria-pressed={active} aria-label={active ? t('mic.stop') : t('mic.off')}>
      <span className={css.glyph} style={{ color: lit || connecting ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-secondary)', transform: `scale(${scale})` }}><Glyph name={glyph} size={20} /></span>
    </button>
    <span className={css.inlineHint} role="tooltip">{statusLabel}</span>
    {active && <div className={css.inlineMenu}>
      {clockActive && <span className={css.inlineTimer}>{formatDuration(voice.activeSeconds)}</span>}
      <button type="button" className={css.inlineButton} onClick={() => onMute()}
        aria-label={muted ? t('mic.unmute') : t('mic.mute')}>
        {muted ? <GlyphMicOff size={16} /> : <GlyphMic size={16} />}
      </button>
      {active && <button type="button" className={css.inlineButton} onClick={() => onStop(sessionId)} aria-label={t('mic.power')}>
        <Glyph name="power" size={16} />
      </button>}
    </div>}
  </div>

  return (
    <div
      className={css.dock}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Status panel: floats above the orb, revealed on hover. Only shown when
          the voice is in a non-obvious state — the idle "voice off" case needs
          no label (the neutral orb already says it). */}
      {hover && (phase !== 'idle' || error !== null) ? (
        <div className={css.statusPanel}>
          <span className={css.statusDot} style={{ backgroundColor: color }} />
          <span className={css.statusLabel}>{statusLabel}</span>
        </div>
      ) : null}

      {/* The round conversation orb (always visible). */}
      <button
        type="button"
        className={css.orbWrap}
        onClick={onClick}
        aria-pressed={active}
        aria-label={active ? t('mic.stop') : t('mic.off')}
      >
        <span
          className={`${css.orb}${lit ? ` ${css.lit}` : ''}${muted ? ` ${css.muted}` : ''}${connecting ? ` ${css.connecting}` : ''}`}
          style={{ backgroundColor: lit ? color : undefined, ['--halo' as string]: color, transform: `scale(${scale})` }}
        >
          <span className={
            pulsing ? `${css.halo} ${css.on} ${css.pulse}` : css.halo
          } />
          <span
            className={css.glyph}
            style={{ color: lit ? 'var(--dsw-alias-label-primary-foreground)' : 'var(--dsw-alias-label-secondary)' }}
          >
            <Glyph name={glyph} size={22} />
          </span>
        </span>
      </button>

      {/* Action menu: a fixed-height slot below the orb. Revealing the buttons
          on hover fills the already-reserved slot, so the orb never moves. */}
      <div className={css.menuSlot}>
        {hover ? (
          <div className={css.actionsMenu}>
            {/* Turn voice off: a dedicated stop button (the same verb the live
                orb uses), shown only while the voice is on — it is meaningless
                (and would be dead) when idle off. */}
            {active ? (
              <button
                type="button"
                className={`${css.actionBtn} ${css.powerBtn}`}
                onClick={() => onStop(sessionId)}
                aria-label={t('mic.power')}
                title={t('mic.power')}
              >
                <Glyph name="power" size={14} />
              </button>
            ) : null}
            {active && <button
              type="button"
              className={css.actionBtn}
              onClick={() => onMute()}
              aria-label={muted ? t('mic.unmute') : t('mic.mute')}
              title={muted ? t('mic.unmute') : t('mic.mute')}
            >
              {muted ? <GlyphMicOff size={14} /> : <GlyphMic size={14} />}
            </button>}

          </div>
        ) : null}
      </div>

      {/* Active-time clock: a fixed-height slot, shown only while active. */}
      <div className={css.timerSlot}>
        {clockActive ? (
          <span className={`${css.clock} ${css.clockActive}`}>
            {formatDuration(voice.activeSeconds)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function noPanel(): boolean { return false }
function subscribeNoPanel(): () => void { return () => {} }

/** Compact adapter for the optional composer control slot. */
export function PanelVoiceControl(props: Omit<MicDockProps, 'zone'> & { fallback?: import('react').ReactNode }) {
  const config = useSyncExternalStore(props.sources.config.subscribe, props.sources.config.getSnapshot)
  if (config.controlLayout !== 'panel') return props.fallback ?? null
  return <MicDock {...props} placement="panel" />
}
