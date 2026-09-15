/** Incremental preview transport; authentication uses the existing host session. */
import { parseVoiceSample, type VoiceSample, type VoiceSelection } from './voice-catalog.ts'

/**
 * Deliver audio before generation finishes and close the preview when cancelled.
 * @param selection - selected provider and model.
 * @param voice - provider voice identifier.
 * @param signal - cancellation from the picker.
 * @param onAudio - ordered PCM chunks for playback.
 * @returns completion after the provider acknowledges session closure.
 */
export async function streamVoicePreview(selection: VoiceSelection, voice: string, signal: AbortSignal,
  onAudio: (sample: VoiceSample) => void): Promise<void> {
  signal.throwIfAborted()
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/voice-sts/preview`)
  let abort: () => void = () => {}
  try {
    await new Promise<void>((resolve, reject) => {
      abort = () => { reject(new Error('Voice preview cancelled')) }
      signal.addEventListener('abort', abort, { once: true })
      socket.onopen = () => { if (!signal.aborted) socket.send(JSON.stringify({ ...selection, voice })) }
      socket.onmessage = (event) => {
        try {
          if (signal.aborted) return
          const frame: unknown = JSON.parse(String(event.data))
          if (typeof frame === 'object' && frame !== null && 'type' in frame) {
            if (frame.type === 'done') resolve()
            else reject(new Error('Voice preview failed'))
          } else onAudio(parseVoiceSample(frame))
        } catch (error) { reject(error instanceof Error ? error : new Error('Voice preview failed')) }
      }
      socket.onerror = () => { reject(new Error('Voice preview connection failed')) }
      socket.onclose = () => { reject(new Error('Voice preview ended before completion')) }
    })
  } finally { signal.removeEventListener('abort', abort); socket.close() }
}
