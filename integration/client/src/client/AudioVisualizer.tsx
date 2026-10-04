/** Live audio waveform contributed to the message toolbar. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribeVoiceAudio } from '@voicemesh/composer/browser'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { assistantOrbEnabled } from './config.ts'
import type { MicDockActions } from './slots.ts'
import css from './AudioVisualizer.module.css'

/**
 * Render the input meter without owning playback or capture.
 *
 * With the assistant cloud enabled, the cloud owns output visualization and
 * this meter stays with the user's microphone. Turning that presentation off
 * restores the combined input/output meter used by earlier builds.
 */
export function AudioVisualizer({ sources, t }: MicDockActions & PropsLocale<'voice'>) {
  const config = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const voice = useSyncExternalStore(sources.voice.subscribe, sources.voice.getSnapshot)
  const [bars, setBars] = useState<readonly number[]>([])
  // Not a preference: the waveform follows the voice itself, so a live session
  // always shows its levels.
  const active = voice.phase !== 'idle' && voice.phase !== 'standby' && voice.phase !== 'connecting' && voice.error === null
  useEffect(() => {
    if (!active) return
    return subscribeVoiceAudio((levels) => {
      const input = levels.input.map(level => config.muted ? 0 : level)
      setBars(assistantOrbEnabled(config)
        ? input
        : levels.output.map((output, i) => Math.max(output, input[i] ?? 0)))
    })
  }, [active, config.assistantOrbEnabled, config.muted])
  if (!active) return null
  return <span className={css.wave} role="img" aria-label={t('settings.audioVisualizer')} title={t('settings.audioVisualizer')}>
    <svg width="64" height="24" viewBox="0 0 64 24" aria-hidden="true">
      <defs>
        <linearGradient id="voice-visualizer-spectrum" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4fc3f7" />
          <stop offset="35%" stopColor="#7c6cf7" />
          <stop offset="70%" stopColor="#f06292" />
          <stop offset="100%" stopColor="#ffb74d" />
        </linearGradient>
      </defs>
      {Array.from({ length: 9 }, (_, i) => {
        const amplitude = bars[i] ?? 0
        const height = 3 + Math.min(1, Math.sqrt(amplitude) * 2) * 19
        return <rect key={i} x={5 + i * 6} y={(24 - height) / 2} width="3" height={height} rx="1.5" fill="url(#voice-visualizer-spectrum)" opacity={amplitude > 0.01 ? 1 : 0.4} />
      })}
    </svg>
  </span>
}
