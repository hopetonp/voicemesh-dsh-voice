/** Optional audio waveform contributed to the message toolbar. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { subscribeVoiceAudio } from '@voicemesh/composer/browser'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { MicDockActions } from './slots.ts'
import css from './AudioVisualizer.module.css'

/** Render live microphone and reply audio without owning playback or capture. */
export function AudioVisualizer({ sources, t }: MicDockActions & PropsLocale<'voice'>) {
  const config = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const voice = useSyncExternalStore(sources.voice.subscribe, sources.voice.getSnapshot)
  const [bars, setBars] = useState<readonly number[]>([])
  const active = config.audioVisualizer && voice.phase !== 'idle' && voice.phase !== 'standby' && voice.phase !== 'connecting' && voice.error === null
  useEffect(() => {
    if (!active) return
    return subscribeVoiceAudio((levels) => {
      setBars(levels.output.map((output, i) => Math.max(output, config.muted ? 0 : levels.input[i] ?? 0)))
    })
  }, [active, config.muted])
  if (!active) return null
  return <span className={css.wave} role="img" aria-label={t('settings.audioVisualizer')} title={t('settings.audioVisualizer')}>
    <svg width="64" height="24" viewBox="0 0 64 24" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => {
        const amplitude = bars[i] ?? 0
        const height = 3 + Math.min(1, Math.sqrt(amplitude) * 2) * 19
        return <rect key={i} x={5 + i * 6} y={(24 - height) / 2} width="3" height={height} rx="1.5" opacity={amplitude > 0.01 ? 1 : 0.4} />
      })}
    </svg>
  </span>
}
