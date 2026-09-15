/** Short feedback that survives speech playback teardown and drains before releasing its output device. */
import { connectChime, type VoiceTone } from './connect-chime.ts'

/** Create a disposable status player. @returns Playback, cancellation, and plugin-disposal actions. */
export function createStatusSounds() {
  let current: AudioContext | undefined
  let drainTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const stop = (): void => {
    clearTimeout(drainTimer)
    drainTimer = undefined
    const context = current
    current = undefined
    if (context !== undefined) void context.close().catch(() => { /* Device shutdown can race browser context closure. */ })
  }
  return {
    stop,
    dispose(): void { disposed = true; stop() },
    play(tone: VoiceTone): void {
      if (disposed) return
      stop()
      const context = new AudioContext({ sampleRate: 16000 })
      current = context
      const notes = connectChime(tone)
      const frames = notes.reduce((n, pcm) => n + pcm.length / 2, 0)
      const buffer = context.createBuffer(1, frames, 16000)
      const samples = buffer.getChannelData(0)
      let offset = 0
      for (const pcm of notes) {
        const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
        for (let i = 0; i < pcm.length; i += 2) samples[offset++] = data.getInt16(i, true) / 32768
      }
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      let endTime = 0
      const closeAfterOutput = (): void => {
        if (current !== context) return
        if (context.state !== 'running') { stop(); return }
        const outputTime = context.getOutputTimestamp?.().contextTime
          ?? context.currentTime - context.baseLatency - (context.outputLatency ?? 0)
        const remaining = endTime - outputTime
        if (remaining <= 0) { stop(); return }
        drainTimer = setTimeout(closeAfterOutput, Math.max(1, Math.ceil(remaining * 1000)))
      }
      // The source's ended event can precede the last sample reaching the output device.
      source.onended = closeAfterOutput
      void context.resume().then(() => {
        if (current !== context) return
        const startTime = context.currentTime
        endTime = startTime + frames / 16000
        source.start(startTime)
      }).catch(() => {
        // Optional feedback stays silent when browser audio permission is unavailable.
        if (current === context) stop()
      })
    },
  }
}
