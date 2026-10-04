/** Assistant-output cloud rendered above the composer while voice is live or parked. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribeVoiceAudio } from '@voicemesh/composer/browser'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { assistantOrbEnabled } from './config.ts'
import { isActivePhase } from './state.ts'
import type { MicDockActions } from './slots.ts'
import css from './VoiceOrb.module.css'

const ATTACK_MS = 110
const RELEASE_MS = 240

/**
 * Ease displayed output energy toward the analyser level.
 * @param current - displayed intensity.
 * @param target - latest output intensity.
 * @param elapsedMs - elapsed animation-frame time.
 * @returns intensity with a gradual attack and release.
 */
export function easeOrbIntensity(current: number, target: number, elapsedMs: number): number {
  const response = 1 - Math.exp(-elapsedMs / (target > current ? ATTACK_MS : RELEASE_MS))
  return current + (target - current) * response
}

/**
 * Speed existing CSS animation timelines without replacing them or changing their phase.
 * @param orb - cloud element whose animations include its descendants.
 * @param intensity - eased output intensity.
 */
export function updateOrbMotion(orb: { getAnimations?: (options?: GetAnimationsOptions) => readonly Pick<Animation, 'updatePlaybackRate'>[] }, intensity: number): void {
  const playbackRate = 0.82 + intensity * 4.7
  const animations = orb.getAnimations?.({ subtree: true })
  if (!animations) return
  for (const animation of animations) {
    animation.updatePlaybackRate(playbackRate)
  }
}

/** Reduce the analyser's nine output bands to one stable cloud intensity. */
export function outputIntensity(levels: readonly number[]): number {
  if (levels.length === 0) return 0
  const average = levels.reduce((sum, level) => sum + level, 0) / levels.length
  return Math.min(1, Math.sqrt(Math.max(0, average)) * 1.45)
}

/**
 * Render an assistant-only audio cloud in the full-width composer dock.
 *
 * The analyser's output bands describe browser playback for Pipeline, PCM,
 * and WebRTC routes. Input levels never reach this component, so user speech
 * cannot animate the assistant cloud.
 */
export function VoiceOrb({ sessionId, onToggle, sources, t }:
  Pick<import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>, 'sessionId'>
  & MicDockActions & PropsLocale<'voice'>) {
  const config = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const voice = useSyncExternalStore(sources.voice.subscribe, sources.voice.getSnapshot)
  const [intensity, setIntensity] = useState(0)
  const orbRef = useRef<HTMLDivElement>(null)
  const intensityRef = useRef(0)
  const targetIntensity = useRef(0)
  const lastSettled = useRef(voice.phase)
  const reconnecting = voice.phase === 'connecting' && lastSettled.current === 'standby'
  if (voice.phase !== 'connecting') lastSettled.current = voice.phase
  const visible = assistantOrbEnabled(config)
    && (isActivePhase(voice.phase) || voice.phase === 'standby' || reconnecting) && voice.error === null
  const metering = visible && isActivePhase(voice.phase)
  const speaking = metering && !config.speakerMuted && intensity > 0.018

  useEffect(() => {
    if (!metering || config.speakerMuted) {
      targetIntensity.current = 0
      intensityRef.current = 0
      setIntensity(0)
      return
    }
    let frame = 0
    let previousTime = performance.now()
    const animate = (time: number) => {
      const next = easeOrbIntensity(intensityRef.current, targetIntensity.current, time - previousTime)
      previousTime = time
      intensityRef.current = Math.abs(next - targetIntensity.current) < .001 ? targetIntensity.current : next
      setIntensity(intensityRef.current)
      if (intensityRef.current !== targetIntensity.current) frame = requestAnimationFrame(animate)
      else frame = 0
    }
    const dispose = subscribeVoiceAudio((levels) => {
      targetIntensity.current = outputIntensity(levels.output)
      if (frame === 0) {
        previousTime = performance.now()
        frame = requestAnimationFrame(animate)
      }
    })
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      dispose()
    }
  }, [metering, config.speakerMuted])

  useEffect(() => {
    if (orbRef.current) updateOrbMotion(orbRef.current, intensity)
  }, [intensity, visible])

  if (!visible) return null
  const standby = voice.phase === 'standby'
  const orb = <div
      ref={orbRef}
      className={css.orb}
      role={standby ? undefined : 'img'}
      aria-label={standby ? undefined : t('voice.orb')}
      aria-hidden={standby || undefined}
      data-speaking={speaking || undefined}
      data-standby={standby || reconnecting || undefined}
      style={{
        ['--voice-orb-scale' as string]: (1 + intensity * 0.12).toFixed(3),
        ['--voice-orb-shadow' as string]: `${(22 + intensity * 24).toFixed(1)}%`,
        ['--voice-orb-cloud-growth' as string]: (intensity * .28).toFixed(3),
      }}
    >
      <span className={css.cloud} aria-hidden />
    </div>
  return <div className={css.frame} data-voice-assistant-orb="">
    {standby ? <button type="button" className={css.resume} aria-label={t('mic.resume')}
      title={t('mic.resume')} onClick={() => { void onToggle(sessionId) }}>{orb}</button> : orb}
  </div>
}
