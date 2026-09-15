/** Bounded authentication checks against the selected live recognition endpoint. */
import { WebSocket } from 'ws'
import { FLUX_LISTEN_URL, grokTurnUrl, buildRecognizer, GEMINI_TRANSCRIPTION_URL, geminiTranscriptionSetup } from '@voicemesh/composer'
import type { WebSocketConnect, TurnStreamingRecognizer } from '@voicemesh/composer'
import { z } from 'zod'

const settingsSchema = z.strictObject({
  engine: z.enum(['deepgram-flux', 'grok', 'fish', 'openai', 'gemini']),
  model: z.string().max(128).optional(),
  key: z.string().trim().min(1).max(4096),
  silenceSec: z.number().min(0).max(30),
})

/**
 * Check STT WebSocket admission without recording audio or starting coding work.
 * @param payload - Selected recognition engine, saved credential, and silence setting.
 * @param signal - Request cancellation.
 * @param timeoutMs - Maximum wait for provider admission.
 * @returns Connection outcome after the diagnostic socket closes; provider bodies and credentials are excluded.
 */
export async function probeStt(payload: unknown, signal: AbortSignal, timeoutMs: number,
  connect?: WebSocketConnect): Promise<{ ok: boolean; message: string }> {
  const settings = settingsSchema.parse(payload)
  signal.throwIfAborted()
  if (settings.engine === 'openai') {
    if (!connect || !settings.model) throw new Error('Transcription model is not selected')
    const recognizer = buildRecognizer(settings.engine, connect, () => settings.key, settings.model) as TurnStreamingRecognizer
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    try {
      for await (const _turn of recognizer.turnStream((async function* () {
        yield new Uint8Array(recognizer.inputSampleRate) })(), deadline)) { /* Completion validates model admission and finalization. */ }
      return { ok: true, message: 'STT connection accepted' }
    } finally { recognizer.dispose() }
  }
  if (settings.engine === 'fish') {
    const recognizer = buildRecognizer('fish', () => { throw new Error('Fish ASR uses HTTP') }, () => settings.key)
    if (!recognizer) throw new Error('Fish recognizer unavailable')
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    const cancel = (): void => recognizer.dispose()
    deadline.addEventListener('abort', cancel, { once: true })
    const started = performance.now()
    try {
      deadline.throwIfAborted()
      await recognizer.transcribe(new Uint8Array(16000))
      return { ok: true, message: `Fish transcription accepted · ${Math.round(performance.now() - started)}ms` }
    } finally { deadline.removeEventListener('abort', cancel); recognizer.dispose() }
  }
  const isGrok = settings.engine === 'grok'
  const isGemini = settings.engine === 'gemini'
  if (isGemini && !settings.model) throw new Error('Transcription model is not selected')
  return new Promise((resolve) => {
    const socket = new WebSocket(isGemini ? GEMINI_TRANSCRIPTION_URL : isGrok ? grokTurnUrl(settings.silenceSec) : FLUX_LISTEN_URL, {
      headers: isGemini ? { 'x-goog-api-key': settings.key } : { Authorization: `${isGrok ? 'Bearer' : 'Token'} ${settings.key}` },
      handshakeTimeout: timeoutMs,
      maxPayload: 1024 * 1024,
    })
    let result: { ok: boolean; message: string } | undefined
    const finish = (outcome: { ok: boolean; message: string }): void => {
      if (result !== undefined) return
      result = outcome
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      socket.terminate()
    }
    const cancel = (): void => { finish({ ok: false, message: 'STT connection test cancelled' }) }
    let phase = 'connection'
    const timer = setTimeout(() => { finish({ ok: false, message: `STT ${phase} timed out` }) }, timeoutMs)
    socket.once('open', () => {
      if (isGemini) { phase = 'provider readiness'; socket.send(JSON.stringify(geminiTranscriptionSetup(z.string().parse(settings.model)))) }
      else if (!isGrok) finish({ ok: true, message: 'STT connection accepted' })
      else phase = 'provider readiness'
    })
    socket.on('message', (data) => {
      if ((!isGrok && !isGemini) || result !== undefined) return
      let event: { type?: string; setupComplete?: unknown; error?: unknown }
      try { event = JSON.parse(String(data)) as { type?: string; setupComplete?: unknown; error?: unknown } }
      catch { return /* Non-JSON provider frames cannot confirm readiness. */ }
      if (isGemini) {
        if (event.setupComplete) finish({ ok: true, message: 'STT connection accepted' })
        else if (event.error) finish({ ok: false, message: 'STT provider rejected the transcription settings' })
        return
      }
      if (event.type === 'transcript.created') {
        phase = 'finalization'
        socket.send(new Uint8Array(3200))
        socket.send(JSON.stringify({ type: 'audio.done' }))
      } else if (event.type === 'transcript.done') finish({ ok: true, message: 'STT connection accepted' })
      else if (event.type === 'error') finish({ ok: false, message: 'STT provider rejected the diagnostic stream' })
    })
    socket.on('error', () => { finish({ ok: false, message: 'STT connection failed' }) })
    socket.once('unexpected-response', (_request, response) => {
      response.resume()
      finish({ ok: false, message: `STT provider HTTP ${response.statusCode ?? 'error'}` })
    })
    socket.once('close', () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      resolve(result ?? { ok: false, message: 'STT connection closed before admission' })
    })
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}
