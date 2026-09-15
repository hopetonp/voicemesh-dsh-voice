/** Playback glyph shared by voice sample controls. */
import css from './VoicePicker.module.css'

/** Show preparation until audio starts, then expose the stop glyph. */
export function VoicePreviewIcon({ loading, playing }: { loading: boolean; playing: boolean }): JSX.Element {
  return <span aria-hidden="true" className={loading ? css.previewSpinner : undefined}>{loading ? '' : playing ? '■' : '▶'}</span>
}
