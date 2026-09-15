import { openaiLiveProvider } from '@voicemesh/composer/server'
/** Authenticated Grok realtime diagnostics; no microphone or coding task is opened. */
import { xaiStsProvider } from '@voicemesh/composer/server'
import { geminiStsProvider } from '@voicemesh/composer/server'
import { openaiStsProvider } from '@voicemesh/composer/server'
import { resolveOpenaiStsAccess } from './sts-openai-access.ts'
import { stsProbeAudio } from './sts-probe-audio.ts'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { StsProtocolCheck, protocolCheckSession } from './sts-protocol-check.ts'

const requestSchema = z.object({
  provider: z.enum(['xai', 'gemini', 'openai', 'openai-live']).default('xai'),
  key: z.string().trim().min(1).max(4096),
  model: z.string().trim().min(1).max(200),
  voice: z.string().trim().min(1).max(100),
  silenceSec: z.number().min(0.1).max(5),
  thinking: z.boolean(),
  protocol: z.boolean().optional(),
}).strict()

const eventSchema = z.record(z.string(), z.unknown())

/**
 * Verify realtime settings, optionally followed by a synthetic audio/tool exchange.
 * @param payload - untrusted settings, request-only credential, and optional protocol-test flag.
 * @param signal - request or plugin cancellation.
 * @param timeoutMs - maximum duration of the connection and every requested diagnostic stage.
 * @returns whether settings were acknowledged and, when requested, the synthetic exchange completed.
 */
export async function probeSts(payload: unknown, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
  const config = requestSchema.parse(payload)
  signal.throwIfAborted()
  const transcriptionModel = config.provider === 'openai' ? await resolveOpenaiStsAccess(config.key, config.model, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])) : undefined
  const provider = config.provider === 'openai-live' ? openaiLiveProvider : config.provider === 'gemini' ? geminiStsProvider : config.provider === 'openai' ? openaiStsProvider : xaiStsProvider
  const adapter = provider.create({
    ...config, ...(transcriptionModel === undefined ? {} : { transcriptionModel }), instructions: config.provider === 'openai-live' ? 'This is an isolated voice diagnostic. When the caller speaks, delegate to the backend immediately. After its result, say exactly: The voice test is ready.' : protocolCheckSession.instructions,
    tools: config.protocol === true ? protocolCheckSession.tools : [],
    connectTimeoutMs: timeoutMs, maxQueuedBytes: 1024 * 1024,
  })
  const setup = adapter.setup
  let awaitingTranscript = config.provider === 'openai'
  let sampleTranscribed = false
  let sampleAnswered = false
  const liveDiagnostic = config.provider === 'openai-live' && config.protocol === true
  const protocol = config.protocol === true && !liveDiagnostic ? new StsProtocolCheck() : undefined
  return new Promise<boolean>((resolve) => {
    const socket = new WebSocket(adapter.url, {
      headers: adapter.headers,
      maxPayload: 1024 * 1024,
      handshakeTimeout: timeoutMs,
    })
    let microphone: ReturnType<typeof setInterval> | undefined
    let liveDelegated = false
    let liveAudio = false
    let liveText = ''
    let settled = false
    let outcome = false
    let finalization: ReturnType<typeof setTimeout> | undefined
    let finalized = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      outcome = ok
      clearTimeout(timer); clearInterval(microphone)
      signal.removeEventListener('abort', abort)
      if (ok && config.provider === 'openai-live' && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'session.close' }))
        finalization = setTimeout(() => { socket.terminate() }, timeoutMs)
      } else socket.terminate()
    }
    const abort = (): void => { finish(false) }
    const timer = setTimeout(abort, timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    socket.on('error', abort)
    socket.once('close', () => {
      if (!settled) finish(false)
      clearTimeout(finalization)
      resolve(outcome && (config.provider !== 'openai-live' || finalized))
    })
    socket.on('open', () => {
      if (settled) return
      socket.send(JSON.stringify(setup))
    })
    socket.on('message', (data, binary) => {
      if (settled) {
        if (config.provider === 'openai-live') {
          try {
            const event = JSON.parse(data.toString()) as { type?: string }
            if (event.type === 'session.closed') { finalized = true; socket.terminate() }
          } catch { /* A malformed final event cannot establish acknowledged closure. */ }
        }
        return
      }
      if (binary && !provider.binaryJsonFrames) return
      let json: unknown
      try {
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
        json = JSON.parse(bytes.toString('utf8'))
      } catch {
        // A malformed provider JSON event cannot establish session readiness.
        finish(false)
        return
      }
      const parsed = eventSchema.safeParse(json)
      if (!parsed.success) { finish(false); return }
      if (parsed.data.type === 'error' || 'error' in parsed.data) {
        if (process.env.DSH_VOICE_DEBUG === '1') console.info('STS probe failed:', parsed.data.type === 'conversation.item.input_audio_transcription.failed' ? 'transcription' : 'provider')
        finish(false); return
      }
      try {
        if (liveDiagnostic && parsed.data.type === 'session.output_audio.delta') liveAudio = true
        for (const event of adapter.decode(parsed.data)) {
          if (liveDiagnostic) {
            if (event.type === 'session.updated') {
              socket.send(JSON.stringify({ type: 'session.input_audio.append', audio: stsProbeAudio }))
              microphone = setInterval(() => { if (!settled) socket.send(JSON.stringify({ type: 'session.input_audio.append', audio: Buffer.alloc(4800).toString('base64') })) }, 100)
            } else if (event.type === 'voice.live-delegation') {
              liveDelegated = true
              socket.send(JSON.stringify({ type: 'session.commentary.append', delegation_id: event.id, content: 'The voice test is ready.' }))
            } else if (event.type === 'voice.live-transcript' && event.role === 'assistant') liveText += String(event.delta)
            if (liveDelegated && liveAudio && /voice.*test.*ready/i.test(liveText)) finish(true)
            continue
          }
          if (settled) return
          let next: boolean | readonly object[]
          if (awaitingTranscript) {
            if (event.type === 'session.updated') {
              next = [{ type: 'input_audio_buffer.append', audio: stsProbeAudio }, { type: 'input_audio_buffer.append', audio: Buffer.alloc(Math.ceil(config.silenceSec * 24000 + 24000) * 2).toString('base64') }]
            } else {
              if (event.type === 'conversation.item.input_audio_transcription.completed') {
                if (typeof event.transcript !== 'string' || !/voice.*test.*ready/i.test(event.transcript)) { finish(false); return }
                sampleTranscribed = true
              }
              if (event.type === 'response.done') {
                const response = z.object({ status: z.string() }).parse(event.response)
                if (response.status !== 'completed') { finish(false); return }
                sampleAnswered = true
              }
              if (!sampleTranscribed || !sampleAnswered) continue
              awaitingTranscript = false
              next = protocol?.start() ?? true
            }
          } else next = event.type === 'session.updated' ? protocol?.start() ?? true : protocol?.accept(event) ?? []
          if (typeof next === 'boolean') { finish(next); return }
          let automatic = false
          for (const command of next) {
            const value = eventSchema.parse(command)
            if (automatic && value.type === 'response.create') { automatic = false; continue }
            for (const message of adapter.encode(value)) socket.send(JSON.stringify(message))
            const item = value.item
            automatic = provider.toolResponseStartsResponse && typeof item === 'object' && item !== null && 'type' in item && item.type === 'function_call_output'
          }
        }
      } catch { finish(false) }

    })
  })
}
