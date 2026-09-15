import { previewLive } from '@voicemesh/composer/server'
/** Isolated voice samples; previews have no coding tools or linked conversation. */
import { z } from 'zod'
import type { LocalVoice } from './local-voice.ts'
import { buildSynthesizer, type WebSocketConnect } from '@voicemesh/composer'
import { openStsChannel } from '@voicemesh/composer/server'
import { openaiStsProvider } from '@voicemesh/composer/server'
import { geminiStsProvider } from '@voicemesh/composer/server'
import { xaiStsProvider } from '@voicemesh/composer/server'
import { resolveOpenaiStsAccess } from './sts-openai-access.ts'
import { voiceRequest, readVoiceBody } from './voice-catalog.ts'

/** Spoken preview phrases shared by cloud and local synthesis. */
export const phrases = [
  "Hey, I'm ready to hit the ground running, so let me know what you'd like me to focus on.",
  "Let's turn that idea into something useful, one thoughtful step at a time.",
  "I'm here to help you work through the details and keep things moving.",
  "Have something on your mind? Tell me about it, and we'll figure out where to start.",
  'We can explore a fresh idea, solve a tricky problem, or pick up right where we left off.',
  "Take your time, I'm listening, and I'm ready whenever you are.",
  "Let's start with what matters most to you and build from there.",
  'A little curiosity can go a long way, so what shall we discover today?',
  "If you have a question or a project in mind, I'd love to hear about it.",
  "Ready when you are; just point me in the right direction and we'll get started.",
] as const

/**
 * Generate a bounded sample using the selected provider and voice.
 * @param input - selected provider, mode, voice, model, and credential.
 * @param signal - preview cancellation and deadline.
 * @param maxBytes - PCM byte limit.
 * @param timeoutMs - provider connection deadline.
 * @param connect - host WebSocket implementation for pipeline synthesizers.
 * @param onAudio - incremental PCM sink; absent callers receive a complete sample.
 * @param local - installed local synthesis provider.
 * @returns PCM16 sample and its playback clock; audio is empty when delivered to the sink.
 */
export async function previewVoice(
  input: unknown, signal: AbortSignal, maxBytes: number, timeoutMs: number, connect: WebSocketConnect,
  onAudio?: (sample: { audio: string; sampleRate: number }) => void, local?: Pick<LocalVoice, 'synthesizer'>,
): Promise<{ audio: string; sampleRate: number }> {
  const localRequest = z.object({ provider: z.literal('kokoro'), mode: z.literal('tts'), model: z.string(), voice: z.string().min(1).max(512) })
  const request = typeof input === 'object' && input !== null && 'provider' in input && input.provider === 'kokoro'
    ? { ...localRequest.parse(input), key: '' } : voiceRequest.parse(input)
  if (request.voice === undefined || request.voice === '' || (request.provider !== 'kokoro' && request.key.trim() === '')) throw new Error('Preview requires a voice and key')
  const phrase = phrases[Math.floor(Math.random() * phrases.length)] ?? phrases[0]
  if (request.provider === 'openai-live') {
    if (request.mode !== 'sts') throw new Error('Live previews require realtime mode')
    return previewLive(request.key, request.model, request.voice, phrase, signal, timeoutMs, maxBytes, onAudio === undefined ? undefined : (pcm) => { onAudio({ audio: pcm.toString('base64'), sampleRate: 24000 }) })
  }
  const chunks: Uint8Array[] = []
  let size = 0
  let sampleRate = 16000
  let tail = Buffer.alloc(0)
  const append = (bytes: Uint8Array): void => {
    signal.throwIfAborted()
    size += bytes.length
    if (size > maxBytes) throw new Error('Voice sample exceeds its limit')
    const joined = tail.length ? Buffer.concat([tail, bytes]) : Buffer.from(bytes)
    const aligned = joined.subarray(0, joined.length - joined.length % 2)
    tail = joined.subarray(aligned.length)
    if (aligned.length === 0) return
    if (onAudio) onAudio({ audio: aligned.toString('base64'), sampleRate })
    else chunks.push(aligned)
  }
  if (request.mode === 'tts') {
    const synth = request.provider === 'kokoro' ? local?.synthesizer(request.voice, append) : buildSynthesizer(request.provider === 'xai' ? 'grok' : request.provider, connect, () => request.key,
      async (url, options) => {
        const response = await fetch(url, { ...options, method: 'POST', signal, redirect: 'error' })
        return { status: response.status, body: '', bodyBytes: await readVoiceBody(response, maxBytes) }
      }, append, request.voice, request.model)
    if (synth === null || synth === undefined) throw new Error('Voice synthesizer is unavailable')
    sampleRate = synth.outputSampleRate
    const abort = (): void => { synth.stop() }
    signal.addEventListener('abort', abort, { once: true })
    try { signal.throwIfAborted(); await synth.speak(phrase); signal.throwIfAborted() }
    finally { signal.removeEventListener('abort', abort); synth.dispose() }
  } else {
    if (request.provider === 'deepgram' || request.provider === 'fish') throw new Error('Unsupported STS provider')
    const provider = request.provider === 'openai' ? openaiStsProvider : request.provider === 'gemini' ? geminiStsProvider : xaiStsProvider
    sampleRate = provider.outputSampleRate
    const transcriptionModel = request.provider === 'openai' ? await resolveOpenaiStsAccess(request.key, request.model, signal) : undefined
    const done = Promise.withResolvers<void>()
    void done.promise.catch(() => {})
    const channel = await openStsChannel({ key: request.key, model: request.model, voice: request.voice,
      ...(transcriptionModel === undefined ? {} : { transcriptionModel }),
      instructions: `Read exactly this voice sample, without adding anything: ${phrase}`, tools: [], thinking: false, silenceSec: 0.5,
      connectTimeoutMs: timeoutMs, maxQueuedBytes: maxBytes,
    }, {
      record: async () => {},
      receive: (event) => {
        if (event.type === 'response.output_audio.delta' && typeof event.delta === 'string') append(Buffer.from(event.delta, 'base64'))
        if (event.type === 'response.done') {
          const response = event.response
          if (typeof response === 'object' && response !== null && 'status' in response && response.status === 'completed') done.resolve()
          else done.reject(new Error('Voice preview did not complete'))
        }
        return Promise.resolve()
      },
    }, signal, provider)
    try {
      await channel.send({ type: 'response.create', response: { instructions: `Read exactly: ${phrase}` } })
      await Promise.race([done.promise, channel.closed.then(() => { throw new Error('Voice preview ended before completion') })])
    } finally { await channel.close() }
  }
  if (size === 0 || size % 2 !== 0) throw new Error('Voice preview returned no playable audio')
  return { audio: Buffer.concat(chunks).toString('base64'), sampleRate }
}
