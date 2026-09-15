/** Selected voice pill with independent picker and sample controls. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { voiceDisplayName } from './voice-catalog.ts'
import type { VoiceCatalogActions, VoiceSelection } from './voice-catalog.ts'
import { VoicePreviewIcon } from './VoicePreviewIcon.tsx'
import { useVoicePreview } from './use-voice-preview.ts'
import css from './VoiceSettings.module.css'

/** Header actions share the picker's provider-specific playback owner. */
export function SelectedVoiceControl({ selection, voice, label = voice, previewVoice, onChoose, t }: PropsLocale<'voice'> & {
  selection: VoiceSelection
  voice: string
  label?: string
  previewVoice: VoiceCatalogActions['previewVoice']
  onChoose: () => void
}): JSX.Element {
  const displayLabel = voiceDisplayName(label)
  const { loading, playing, sampleError, preview, stop } = useVoicePreview(selection, previewVoice)
  return <div className={css.quickVoice}>
    <button type="button" className={css.voiceChoice} aria-label={`${t('picker.quick')} ${displayLabel}`}
      onClick={() => { stop(); onChoose() }}><span className={css.voiceDot} aria-hidden="true" />{displayLabel}</button>
    <button type="button" className={css.voicePreview} disabled={voice === ''}
      aria-label={`${t(playing === null && loading === null ? 'picker.preview' : 'picker.stop')} ${displayLabel}`}
      title={t(playing === null && loading === null ? 'picker.preview' : 'picker.stop')}
      aria-busy={loading === voice} onClick={() => { void preview(voice) }}>
      <VoicePreviewIcon loading={loading === voice} playing={playing === voice} /></button>
    {sampleError && <span className={css.previewError} role="alert">{t('picker.previewFailed')}</span>}
  </div>
}
