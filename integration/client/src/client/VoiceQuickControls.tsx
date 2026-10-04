/**
 * VoiceQuickControls: the live voice clock, manual pause, and mute beside the
 * optional waveform.
 *
 * The orb owns turning voice on and off. These are the three things worth
 * reaching mid-session without hovering: how long the voice has been live (or
 * the words "Standing by" while it is parked, "Resuming..." while a parked
 * session comes back, or "Connecting..." while a fresh one opens), a manual
 * pause (the manual pause
 * that the inactivity deadline otherwise performs on its own), and microphone
 * mute. Everything here appears only while voice is on; the waveform keeps its
 * own visibility rule, so the cluster adds no width when voice is off.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AudioVisualizer } from './AudioVisualizer.tsx'
import { Glyph, GlyphMic, GlyphMicOff, GlyphPower, GlyphResume, GlyphVolume, GlyphVolumeOff } from './glyphs.tsx'
import { formatDuration, isActivePhase } from './state.ts'
import type { MicDockActions } from './slots.ts'
import type { StsModelListing } from './sts-model.ts'
import { SelectionTip, type SelectionTipRow } from './SelectionTip.tsx'
import { TTS_ENGINES, pipelineModel, pipelineVoice } from './config.ts'
import { resolveStsSettings } from './sts-settings.ts'
import { voiceDisplayName } from './voice-catalog.ts'
import { thinkingLevelLabel } from './locales.ts'
import css from './VoiceQuickControls.module.css'

/** Props of the tool-row cluster: the session kit, the dock verbs, and the locale seat. */
export type VoiceQuickControlsProps =
  Pick<import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.right'>, 'sessionId'>
  & MicDockActions
  & PropsLocale<'voice'>

/** Power, resume while parked, mute, and the elapsed clock or the standing-by word. */
export function VoiceQuickControls(props: VoiceQuickControlsProps) {
  const { sessionId, onToggle, onStop, onMute, onSpeakerMute, listStsModels, sources, t } = props
  const voice = useSyncExternalStore(sources.voice.subscribe, sources.voice.getSnapshot)
  const config = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const phase = voice.phase
  // What the row is speaking through, for the status indicator's own tip: the settings panel is the
  // only other place these are visible, and it is closed while a session runs.
  const realtime = config.voiceMode === 'sts'
  const selection = resolveStsSettings(config)
  const activeProvider = realtime ? t(`sts.${selection.provider}`)
    : TTS_ENGINES.find(engine => engine.id === config.ttsEngine)?.label ?? t('settings.chooseSynthesis')
  const activeModel = realtime ? selection.model : pipelineModel(config, 'tts')
  const activeVoice = realtime ? selection.voice : pipelineVoice(config)
  const [tipOpen, setTipOpen] = useState(false)
  const [stsCatalog, setStsCatalog] = useState<readonly StsModelListing[] | null>(null)
  /** The provider whose catalog is already being fetched, so one open costs one call. */
  const catalogProvider = useRef<string | null>(null)
  const catalogAbort = useRef<AbortController | null>(null)
  const onTipOpenChange = useCallback((open: boolean) => { setTipOpen(open) }, [])
  useEffect(() => () => { catalogAbort.current?.abort() }, [])
  // Asked for when the tip first opens, not when the voice starts: a session that never shows the
  // tip pays nothing, and a provider that refuses the catalog costs the thinking row alone, because
  // every other row comes from settings the page already holds.
  useEffect(() => {
    if (!tipOpen || !realtime || listStsModels === undefined) return
    const provider = selection.provider
    if (catalogProvider.current === provider) return
    catalogProvider.current = provider
    const controller = new AbortController()
    catalogAbort.current = controller
    void listStsModels(controller.signal).then((listings) => {
      if (!controller.signal.aborted) setStsCatalog(listings)
    }).catch(() => { catalogProvider.current = null })
  }, [tipOpen, realtime, selection.provider, listStsModels])
  // Which two levels a model selects between is the catalog's answer, never the model name's, so the
  // level row waits for it: naming a level the provider ignores is worse than naming none.
  const thinkingLevels = stsCatalog?.find(model => model.id === activeModel)?.thinking ?? null
  const selectionRows: SelectionTipRow[] = [
    { label: t('sts.provider'), value: activeProvider },
    { label: t('conv.model'), value: activeModel === '' ? t('key.unset') : activeModel },
    { label: t('sts.voice'), value: voiceDisplayName(activeVoice) || t('key.unset') },
    ...realtime && thinkingLevels !== null
      ? [{ label: t('sts.thinking'), value: thinkingLevelLabel(t, config.stsThinking ? thinkingLevels.on : thinkingLevels.off) }]
      : [],
  ]
  // A parked voice keeps its elapsed clock and can still deliver an owed answer;
  // it is left to the inactivity deadline, so the row only names the state.
  const parked = phase === 'standby'
  const connecting = phase === 'connecting'
  const active = phase !== 'idle'
  const muted = config.muted
  const speakerMuted = config.speakerMuted === true
  const error = voice.error
  // A notice is not a failure: it is shown here, on its own, and it fades out on
  // its own. The orb, the buttons, and the glyph keep their normal state.
  const notice = voice.notice
  // A connecting phase that follows a parked voice is a resume: the row says so
  // while the control comes back, instead of leaving the park label up.
  const lastSettled = useRef(phase)
  useEffect(() => { if (phase !== 'connecting') lastSettled.current = phase }, [phase])
  const resuming = phase === 'connecting' && lastSettled.current === 'standby'
  // The status indicator in the middle of the row — the live clock, or the one word the parked,
  // resuming, and connecting phases get — is the row's own label, so it is what carries the tip.
  const status = isActivePhase(phase)
    ? { text: formatDuration(voice.activeSeconds), className: css.timer }
    : parked ? { text: t('mic.standby'), className: `${css.standby} ${css.standbyParked}` }
      : resuming ? { text: t('mic.resuming'), className: css.standby }
        : connecting ? { text: t('mic.connecting'), className: css.standby } : null
  const cancelLabel = t('mic.power')
  const resumeLabel = t('mic.resume')
  const muteLabel = muted ? t('mic.unmute') : t('mic.mute')
  const speakerLabel = speakerMuted ? t('mic.speakerUnmute') : t('mic.speakerMute')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => { setCopied(false) }, 1500)
    return () => { clearTimeout(timer) }
  }, [copied])
  const copyLabel = copied ? t('mic.copied') : t('mic.copyError')
  // A failed session stays on screen after the voice stops, so the message can
  // be read, selected, or copied into a report instead of vanishing on hover.
  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(true) }, () => { setCopied(false) })
  }
  const copyError = (): void => {
    if (error === null) return
    copy(error)
  }
  return <span className={css.cluster}>
    {notice === null ? null : <span className={css.notice} role="status" title={notice}>
      <span className={css.noticeText}>{notice}</span>
      <button
        type="button"
        className={css.action}
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => { copy(notice) }}
      >
        <Glyph name="copy" size={14} />
      </button>
    </span>}
    {error === null ? null : <span className={css.failure} role="status" title={error}>
      <span className={css.failureText}>{error}</span>
      <button
        type="button"
        className={css.action}
        aria-label={copyLabel}
        title={copyLabel}
        onClick={copyError}
      >
        <Glyph name="copy" size={14} />
      </button>
    </span>}
    {active ? <>
      {/* The power button cancels the whole voice session, the same outcome as
          the composer's voice button, and it is always here while voice is on;
          parking is left to the inactivity deadline, so nothing pauses. */}
      <button
        type="button"
        className={css.action}
        aria-label={cancelLabel}
        title={cancelLabel}
        onClick={() => { onStop(sessionId) }}
      >
        <GlyphPower size={15} />
      </button>
      {/* Parking releases the microphone. This control and the standby orb
          resume the same parked session. */}
      {parked ? <button
        type="button"
        className={css.action}
        aria-label={resumeLabel}
        title={resumeLabel}
        onClick={() => { void onToggle(sessionId) }}
      >
        <GlyphResume size={15} />
      </button> : null}
      {/* The active-time clock sits immediately beside that button: the two
          belong together, since that is where the clock stops. Parked always
          renders the same words, whether the agent still owes an answer or the
          user's own turn has ended: the parked state must not look different
          because of what the agent happens to be doing. Parked is also the one
          resting state that lasts, so its label carries a colour animation;
          resuming and connecting are brief and stay quiet. */}
      {status === null ? null : <SelectionTip t={t} side="top" summary={status.text} rows={selectionRows}
        anchorClassName={`${css.tipAnchor} ${status.className}`} onOpenChange={onTipOpenChange} />}
      <button
        type="button"
        className={`${css.action}${muted ? ` ${css.muted}` : ''}`}
        aria-pressed={muted}
        aria-label={muteLabel}
        title={muteLabel}
        onClick={() => { onMute() }}
      >
        {muted ? <GlyphMicOff size={15} /> : <GlyphMic size={15} />}
      </button>
      {/* The speaker toggle is separate from the microphone: silencing the reply and
          silencing the user are independent, and neither stops the session. */}
      <button
        type="button"
        className={`${css.action}${speakerMuted ? ` ${css.muted}` : ''}`}
        aria-pressed={speakerMuted}
        aria-label={speakerLabel}
        title={speakerLabel}
        onClick={() => { onSpeakerMute() }}
      >
        {speakerMuted ? <GlyphVolumeOff size={15} /> : <GlyphVolume size={15} />}
      </button>
    </> : null}
    <AudioVisualizer {...props} />
  </span>
}
