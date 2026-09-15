/** Shared lifecycle cues for Pipeline and STS. */

/** Voice connection feedback, encoded as PCM16 mono at 16 kHz. */
export type VoiceTone = 'connected' | 'disconnected' | 'standby'

/**
 * Generate soft status notes.
 * @param tone - connection transition.
 * @param sampleRate - output device PCM clock.
 * @returns PCM16 notes with smooth envelopes.
 */
export function connectChime(tone: VoiceTone = 'connected', sampleRate = 16000): readonly Uint8Array[] {
  if (tone === 'standby') return [beep(392, sampleRate, 0.16, 0.09)]
  if (tone === 'connected') return [startChime(sampleRate)]
  return [659.25, 523.25].map(pitch => beep(pitch, sampleRate, 0.10, 0.12))
}

/** A short PCM16 sine beep for the connect chime (L16 mono 16 kHz). */
function beep(freq: number, sampleRate: number, seconds: number, amplitude = 0.5): Uint8Array {
  const n = Math.floor(sampleRate * seconds)
  const out = new Uint8Array(n * 2)
  const attackMs = 0.015
  const releaseMs = 0.04
  const attack = sampleRate * attackMs
  const release = sampleRate * releaseMs
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    // A trapezoidal envelope: gentle fade-in, steady body, smooth fade-out — so
    // the chime is soft and mellow (Codex-like) rather than a hard-edged beep.
    let env = 1
    if (i < attack) env = i / attack
    else if (i > n - release) env = (n - i) / release
    const v = Math.round(amplitude * env * Math.sin(2 * Math.PI * freq * t) * 0x7fff) & 0xffff
    out[i * 2] = v & 0xff
    out[i * 2 + 1] = v >> 8
  }
  return out
}

/** Soft three-note ready melody with overlapping decays. */
function startChime(sampleRate: number): Uint8Array {
  const out = new Uint8Array(Math.round(sampleRate * 0.62) * 2)
  const data = new DataView(out.buffer)
  const notes = [[0, 392, 0.25], [0.12, 587.33, 0.30], [0.22, 783.99, 0.34]] as const
  for (let i = 0; i < out.length / 2; i++) {
    const t = i / sampleRate
    let value = 0
    for (const [start, frequency, duration] of notes) {
      const x = t - start
      if (x < 0 || x >= duration) continue
      const attack = Math.sin(Math.min(1, x / 0.024) * Math.PI / 2) ** 2
      const release = Math.sin(Math.min(1, (duration - x) / 0.09) * Math.PI / 2) ** 2
      const envelope = attack * release * Math.exp(-x * 7)
      value += 0.105 * envelope * (Math.sin(2 * Math.PI * frequency * x)
        + 0.045 * Math.exp(-x * 10) * Math.sin(4 * Math.PI * frequency * x))
    }
    data.setInt16(i * 2, Math.round(value * 32767), true)
  }
  return out
}
