/**
 * Inline SVG glyphs for the voice orb. The DSH icon batch has no mic/volume
 * glyph, so these are drawn locally; they follow the set's convention
 * (`fill="currentColor"`, take `{size}`) so they inherit the orb's color.
 */
export type GlyphName = 'mic' | 'mic-off' | 'volume' | 'warn' | 'wave' | 'read-back' | 'power' | 'resume' | 'copy' | 'stop' | 'volume-off'

interface GlyphProps {
  size?: number
}

/** A filled microphone. */
export function GlyphMic({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1a2.6 2.6 0 0 0-2.6 2.6v4.8a2.6 2.6 0 0 0 5.2 0V3.6A2.6 2.6 0 0 0 8 1Z" fill="currentColor" />
      <path d="M4.2 8.2c0 2.1 1.7 3.8 3.8 3.8s3.8-1.7 3.8-3.8H13c0 2.9-2.2 5.2-5 5.2s-5-2.3-5-5.2h1.2Z" fill="currentColor" />
      <path d="M7.4 11.7v2.2h1.2v-2.2H7.4Z" fill="currentColor" />
    </svg>
  )
}

/** A muted microphone (slash across the mic). */
export function GlyphMicOff({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1a2.6 2.6 0 0 0-2.6 2.6v1.1l5.2 5.2V3.6A2.6 2.6 0 0 0 8 1Z" fill="currentColor" />
      <path d="M4.2 8.2c0 .4.05.7.14 1.05l3.66 3.66h-1.6l-4-4 1.1-1.1c.1.15.3.25.7.39Z" fill="currentColor" />
      <path d="M7.4 11.7v2.2h1.2v-2.2H7.4Z" fill="currentColor" />
      <path d="M2.3 1.4l12.3 12.3-.85.85L1.45 2.25 2.3 1.4Z" fill="currentColor" />
    </svg>
  )
}

/** A speaker with sound waves (speaking / read-back). */
export function GlyphVolume({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 6v4h2.6l3.4 2.8V3.2L4.6 6H2Z" fill="currentColor" />
      <path d="M10.2 5.2a3.4 3.4 0 0 1 0 5.6l.7.9a4.4 4.4 0 0 0 0-7.4l-.7.9Z" fill="currentColor" />
      <path d="M11.9 3.4a6 6 0 0 1 0 9.2l.7.9a7 7 0 0 0 0-11l-.7.9Z" fill="currentColor" />
    </svg>
  )
}

/** An exclamation marker for the error state. */
export function GlyphWarn({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.2 4.4h1.6v4.2H7.2V4.4ZM8 11.6a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z" fill="currentColor" />
    </svg>
  )
}

/**
 * Five rounded blue voice bars. The ramp
 * is drawn once and re-tinted per surface through `--voice-wave-*`, so the bars
 * keep their contrast on a light-mode button instead of washing out; the
 * fallbacks are the values for the dark surface.
 */
export function GlyphWave({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.15" y="5.2" width="1.7" height="5.6" rx="0.85" fill="var(--voice-wave-1, #c3d4ee)" />
      <rect x="3.65" y="0" width="1.7" height="16" rx="0.85" fill="var(--voice-wave-2, #aec8f0)" />
      <rect x="7.15" y="3.2" width="1.7" height="9.6" rx="0.85" fill="var(--voice-wave-3, #98b9ef)" />
      <rect x="10.65" y="1.5" width="1.7" height="13" rx="0.85" fill="var(--voice-wave-4, #80a9ed)" />
      <rect x="14.15" y="5.2" width="1.7" height="5.6" rx="0.85" fill="var(--voice-wave-5, #6395e7)" />
    </svg>
  )
}

/** A speaking person with sound waves (Material `record_voice_over`) — "read
 * back the last reply". Chosen over a bare speaker so the action reads as
 * "replay aloud" rather than a generic volume control. */
export function GlyphReadBack({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* The speaker's head + shoulders. */}
      <circle cx="5" cy="4.2" r="2.1" fill="currentColor" />
      <path d="M2.4 12.2c0-1.7 1.1-2.7 2.6-2.7s2.6 1 2.6 2.7v.9H2.4v-.9Z" fill="currentColor" />
      {/* Sound waves emanating from the speaker. */}
      <path d="M9.6 5.4a3.5 3.5 0 0 1 0 5.2l.7.8a4.6 4.6 0 0 0 0-6.8l-.7.8Z" fill="currentColor" />
      <path d="M11.5 3.7a6.3 6.3 0 0 1 0 8.6l.7.8a7.4 7.4 0 0 0 0-10.2l-.7.8Z" fill="currentColor" />
    </svg>
  )
}

/** A power glyph (circle with a vertical gap at the top) — "turn off voice". */
export function GlyphPower({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
      <path d="M11.9 4.8a6 6 0 1 1-7.8 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/** A speaker with a cross — the speaker is muted. */
export function GlyphVolumeOff({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.4 6.1h2.3L8 3.3v9.4L4.7 9.9H2.4a.6.6 0 0 1-.6-.6V6.7a.6.6 0 0 1 .6-.6Z" fill="currentColor" />
      <path d="M10.6 6.2 14 9.6m0-3.4-3.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** A play triangle — resume a parked voice loop. */
export function GlyphResume({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 3.2a.9.9 0 0 1 1.38-.75l6 4.8a.9.9 0 0 1 0 1.5l-6 4.8A.9.9 0 0 1 5 12.6V3.2Z" fill="currentColor" />
    </svg>
  )
}

/** A cross — the voice is connected, so this control stops it. */
export function GlyphStop({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

/** Two offset sheets — copy the failure text. */
export function GlyphCopy({ size = 18 }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.4 1.8h6.2c.7 0 1.2.5 1.2 1.2v6.2h-1.5V3.3H5.4V1.8Z" fill="currentColor" />
      <rect x="2.6" y="5.4" width="7.9" height="8" rx="1.3" fill="currentColor" />
    </svg>
  )
}

/** Resolve a glyph by name. */
export function Glyph({ name, size }: GlyphProps & { name: GlyphName }) {
  const s = size ?? 18
  switch (name) {
    case 'mic-off':
      return <GlyphMicOff size={s} />
    case 'volume':
      return <GlyphVolume size={s} />
    case 'warn':
      return <GlyphWarn size={s} />
    case 'wave':
      return <GlyphWave size={s} />
    case 'read-back':
      return <GlyphReadBack size={s} />
    case 'power':
      return <GlyphPower size={s} />
    case 'resume':
      return <GlyphResume size={s} />
    case 'volume-off':
      return <GlyphVolumeOff size={s} />
    case 'copy':
      return <GlyphCopy size={s} />
    case 'stop':
      return <GlyphStop size={s} />
    case 'mic':
    default:
      return <GlyphMic size={s} />
  }
}
