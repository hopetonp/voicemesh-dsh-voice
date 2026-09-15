import { fetchViaVoiceHost } from './voice-credentials.ts'
import { streamPipelineTts } from './pipeline-tts.ts'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { PipelineConversation } from './pipeline-conversation.ts'
/**
 * The DSH transport adapter: binds the browser voice loop to the host voice
 * routes and to a live DSH session.
 *
 * This is the join between the loop and the harness. Every Deepgram call
 * (STT, TTS, health) goes through host routes, so the browser never hits the
 * Deepgram CORS boundary and the key stays where the user put it. It provides:
 *   - the STT call (POST raw PCM16 → `{ text }`),
 *   - the TTS call (POST `{ text }` → binary L16, played into a PCM sink),
 *   - the session prompt (`session.prompt`),
 *   - reply observation (the session event source),
 *   - a connectivity probe (GET health route).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import { createPipelinePlayback } from '@voicemesh/composer/browser'
import { createMicCapture, type MicHandle } from '@voicemesh/composer/browser'
import { buildVoiceLoop, type VoiceLoopOptions, type VoiceLoop, type VoiceLoopHost, type SttStreamHandle, type TranscriptEcho, type VoiceAckDecision } from './loop.ts'
import type { VoiceRuntimeStore } from './state.ts'
import { pipelineModel, type VoiceConfig } from './config.ts'

import { spokenResponseInstructions } from '@dsh-voice/harness-policy'
import { readLastOutputRemote, writeLastOutputRemote } from './last-output.ts'

/** The host voice route paths. */
export const STT_ROUTE = '/api/voice/stt'
export const STT_STREAM_ROUTE = '/api/voice/stt/stream'
export const STT_WS_ROUTE = '/api/voice/stt/ws'
export const TTS_ROUTE = '/api/voice/tts'
export const HEALTH_ROUTE = '/api/voice/health'

/** A minimal assistant-message event value, for the pure extractor. */
interface AssistantMessageEventData {
  message: { content: unknown }
}

/**
 * Extract the spoken text from a SessionEvent. Pure and exported so it is
 * unit-testable without a cordis `Context`.
 */
export function assistantText(event: { type: string; data?: AssistantMessageEventData }): string {
  if (event.type !== 'assistant/message') return ''
  const content = event.data?.message.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(b => (b as { type?: string }).type === 'text')
    .map(b => (b as { text?: string }).text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract the read-back text from a session event: the last `assistant/message`
 * or `tool/result`, both of which carry their text under `data.message.content`
 * in this harness (the same shape Flutter's `assistantMessageText` reads for
 * both). Distinct from [assistantText] only in accepting `tool/result`, which is
 * what "read back the last output" (Flutter `lastCodeOutput`) surfaces.
 */
export function lastOutputText(event: { type: string; data?: AssistantMessageEventData }): string {
  if (event.type !== 'assistant/message' && event.type !== 'tool/result') return ''
  const content = event.data?.message.content
  if (!Array.isArray(content)) return ''
  return content
    .filter(b => (b as { type?: string }).type === 'text')
    .map(b => (b as { text?: string }).text ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Live dependencies the transport reads per call. */
export interface VoiceDeps {
  /** The host STT endpoint path. */
  sttRoute: string
  /** The host streaming STT endpoint path (HTTP ndjson fallback). */
  sttStreamRoute: string
  /** The host streaming STT WebSocket path (live partial transcripts). */
  sttWsRoute: string
  /** The host TTS endpoint path. */
  ttsRoute: string
  /** The host health endpoint path. */
  healthRoute: string
  /** Whether the mic is muted (capture suppressed). */
  isMuted(): boolean
  /** Whether to speak the agent's reply back. */
  isReadBack(): boolean
  /** The Deepgram Aura voice model id used for read-back. */
  getVoice(): string
  /** The STT engine id (passed to the host factory). */
  getSttEngine(): string
  /** The TTS engine id (passed to the host factory). */
  getTtsEngine(): string
  /** The full persisted voice config (for the loop's live reads). */
  getConfig(): VoiceConfig
}

/** A result of the STT connectivity probe. */
export interface SttHealth {
  ok: boolean
  keyConfigured?: boolean
  message: string
}

/** A result of the conversational-model reachability probe. */
export interface ConversationalHealth {
  ok: boolean
  /** Human-readable outcome (reachable / the HTTP status / the error message). */
  message: string
  /** The model id the probe exercised, when it reached the endpoint. */
  model?: string
  /** Whether the config was complete enough to attempt the probe. */
  configured?: boolean
  /** Round-trip time in milliseconds (when the probe settled, success or fail). */
  ms?: number
}

/** A result of listing an endpoint's OpenAI-compatible `/models`. */
export interface ConversationalModels {
  ok: boolean
  /** Model ids the endpoint advertises (unsorted; may include duplicates). */
  models: string[]
  providers?: { id: string; name: string; models: { id: string; name: string }[] }[]
  /** Human-readable outcome when it failed (HTTP status / error detail). */
  message?: string
  /** Whether the request was made at all (false = key/base URL missing). */
  attempted?: boolean
}

/**
 * Build a DSH-backed `VoiceLoopHost` plus the derived seams.
 * @param ctx - client root context.
 * @param deps - live key + route paths + mute/read-back reads.
 */
export function buildDshTransport(
  ctx: ClientContext,
  deps: VoiceDeps,
): {
  host: VoiceLoopHost
  unlock(): Promise<void>
  /** Close the pipeline playback device after capture ends. @returns device closure completion. */
  closeAudio(): Promise<void>
  /** Probe the selected STT provider’s connectivity/auth through the host health route. */
  probe(): Promise<SttHealth>
  /** Probe the configured conversational model (reachability + key + model). */
  probeConversational(): Promise<ConversationalHealth>
  /** List the configured endpoint's advertised models (provider model picker). */
  listConversationalModels(): Promise<ConversationalModels>
} {
  let ttsCut = false
  const keyHeaders = (_engine: string): Record<string, string> => ({ 'X-Stt-Model': pipelineModel(deps.getConfig(), 'stt') })

  /** Resolve the live session face bound to a session id, or undefined. */
  const sessionFor = (sessionId: string): SessionFace | undefined =>
    ctx.sessions.binding(sessionId as SessionId)?.session

  const postStt = (pcm16: Uint8Array, sessionId: string): Promise<{ ok: boolean; text: string; error?: string }> => {
    const engine = deps.getSttEngine()
    return fetch(`${deps.sttRoute}?session=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Stt-Engine': engine,
        ...keyHeaders(engine),
      },
      body: pcm16 as unknown as BodyInit,
    }).then(async (res) => {
      const body = (await res.json().catch(() => null)) as { ok?: boolean; text?: string; error?: string } | null
      if (!res.ok) throw new Error(body?.error || `voice-stt HTTP ${res.status}`)
      return { ok: body?.ok ?? true, text: body?.text ?? '' }
    })
  }

  let cueSpeechState: 'speaking' | 'paused' = 'speaking'
  let currentConversation: { sessionId: string; id: string; model: PipelineConversation } | undefined
  const synthesize = async (text: string, audio: (pcm: Uint8Array, rate: number) => void, signal: AbortSignal): Promise<void> => {
    const engine = deps.getTtsEngine()
    const res = await fetch(deps.ttsRoute, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', ...keyHeaders(engine) },
      body: JSON.stringify({ text, voice: deps.getVoice(), engine, model: pipelineModel(deps.getConfig(), 'tts') }),
    })
    if (!res.ok) throw new Error(`voice-tts HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`)
    if (!res.body) throw new Error('TTS returned no audio')
    const rate = Number(res.headers.get('X-Voice-Sample-Rate'))
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        if (value.byteLength) audio(value, rate)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  const playback = createPipelinePlayback({
    synthesize,
    async synthesizeStream(texts, audio, signal) {
      const engine = deps.getTtsEngine()
      if (engine === 'fish' || engine === 'grok' || (engine === 'deepgram' && deps.getVoice().startsWith('flux-'))) {
        await streamPipelineTts(deps.ttsRoute, {
          engine, voice: deps.getVoice(), timeoutMs: deps.getConfig().stsConnectTimeoutMs,
        }, texts, audio, signal)
      } else for await (const text of texts) await synthesize(text, audio, signal)
    },
    get charactersPerSecond() { return deps.getConfig().stsCaptionCharactersPerSecond },
    get cueVolume() { return deps.getConfig().backchannelVolume },
    caption: async () => {},
  })
  const playTexts = async (
    texts: AsyncIterable<string> | Iterable<string>, onStart?: () => void, signal?: AbortSignal,
    nativeStream = false, sessionId?: string,
  ): Promise<void> => {
    ttsCut = false
    await playback.play(texts, onStart, signal, false, async (caption, captionId) => {
      if (!sessionId || !deps.getConfig().transcriptHistory) return
      const connection = ctx.get('connection')
      if (connection === undefined) throw new Error('Voice connection unavailable')
      const result = await connection.rpc.call('/voice-pipeline', 'exchange', {
        sessionId, user: '', assistant: caption.text,
        playback: { id: captionId, phase: caption.phase, interrupted: caption.interrupted },
      })
      if (!result.ok) throw new Error('Voice transcript could not be saved')
    }, nativeStream)
  }

  const conversationFor = (sessionId: string): PipelineConversation => {
    if (currentConversation?.sessionId !== sessionId) {
      currentConversation?.model.cancelPreparation()
      const id = randomUUID()
      currentConversation = { sessionId, id, model: new PipelineConversation({
        contextTurns: () => deps.getConfig().pipelineContextTurns,
        endConversationEnabled: () => deps.getConfig().endConversationEnabled,
        toolRounds: () => deps.getConfig().pipelineToolRounds,
        responseDetail: () => deps.getConfig().responseDetail,
        request: (body, requestSignal) => {
          const c = deps.getConfig()
          return fetchConversational(`${conversationalRoute(c)}/chat/completions`, {
            method: 'POST', signal: requestSignal,
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: c.conversationalModel, temperature: 0.3, reasoning_effort: conversationalReasoningEffort(c), ...body,
              voiceSessionId: sessionId,
            }),
          })
        },
        tool: async (name, args, callId, requestSignal) => {
          requestSignal.throwIfAborted()
          if (name === 'get_last_output') {
            if (typeof args !== 'object' || args === null || Object.keys(args).length !== 0) throw new Error('Read-back takes no arguments')
            return { text: await host.readBackLastOutput?.(sessionId) ?? '' }
          }
          const connection = ctx.get('connection')
          if (connection === undefined) throw new Error('Voice connection unavailable')
          const result = await connection.rpc.call('/voice-pipeline', 'tool', { sessionId, conversationId: id, callId, name, args }, requestSignal)
          if (!result.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error.message)
          return result.value
        },
      }) }
    }
    return currentConversation.model
  }

  const host: VoiceLoopHost = {
    async stt(pcm16: Uint8Array, sessionId: string): Promise<string> {
      const result = await postStt(pcm16, sessionId)
      if (!result.ok) throw new Error(result.error ?? 'voice-stt failed')
      return result.text
    },

    async sttStream(sessionId: string, signal?: AbortSignal): Promise<SttStreamHandle> {
      signal?.throwIfAborted()
      // Live STT over a WebSocket: the browser cannot stream an upload body via
      // `fetch` (Chrome rejects `duplex:'half'` request bodies — it failed with
      // "Failed to fetch" and silently fell back to batch), so audio travels up
      // a WS instead (Flutter parity). The host forwards each binary PCM16 frame
      // to Deepgram Flux and streams interim `{type:'partial'|'transcript',
      // text, ended, last}` NDJSON lines back, so the transcript forms live.
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const engine = deps.getSttEngine()
      const url = `${proto}://${location.host}${deps.sttWsRoute}?session=${encodeURIComponent(sessionId)}&engine=${encodeURIComponent(engine)}&model=${encodeURIComponent(pipelineModel(deps.getConfig(), 'stt'))}`
      const ws = new WebSocket(url)
      let finalizing = false
      let buffered: Uint8Array[] = []
      let ready = false
      let resolveOpen!: () => void
      let rejectOpen!: (e: Error) => void
      const open = new Promise<void>((resolve, reject) => {
        resolveOpen = resolve
        rejectOpen = reject
      })
      const partialHandlers: ((t: string) => void)[] = []
      // The last NON-EMPTY transcript. Deepgram sends `""` reset partials after
      // a phrase (and empty finals), which previously overwrote this and made
      // `end()` resolve `''`, so the turn fell to the batch route and usually
      // came back empty too — the user's words vanished from the history. Keep
      // the last non-empty value so a trailing reset never erases real speech.
      let lastText = ''
      type Final = { text: string } | { error: Error }
      let completed: Final | undefined
      let settleFinal: ((result: Final) => void) | undefined
      const settle = (result: Final): void => {
        if (settleFinal !== undefined) { const resolve = settleFinal; settleFinal = undefined; resolve(result) }
        else completed = result
      }
      const fail = (error: Error): void => { rejectOpen(error); settle({ error }) }
      const openingTimer = setTimeout(() => {
        fail(new Error('STT connection timed out'))
        ws.close()
      }, deps.getConfig().stsConnectTimeoutMs)
      // Copy into an ArrayBuffer-backed view: browser WebSocket.send wants
      // ArrayBufferView<ArrayBuffer>, and a detached/SharedArrayBuffer-backed
      // Uint8Array otherwise fails type checking.
      const sendBytes = (c: Uint8Array): void => {
        ws.send(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer)
      }
      // The stream is only ready to feed audio once the host has opened its own
      // Deepgram socket (it sends `{type:'ready'}`). Otherwise the first burst of
      // speech is lost while that slower handshake completes — so we resolve this
      // promise on the ready frame, not on `onopen`, and buffer audio until then.
      ws.onopen = () => { /* socket is up; wait for the host's ready frame */ }
      ws.onerror = () => { clearTimeout(openingTimer); fail(new Error('STT connection failed')) }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        const line = ev.data.trim()
        if (line === '') return
        try {
          const f = JSON.parse(line) as { type?: string; text?: string; last?: string; ended?: boolean; message?: string }
          if (f.type === 'error') { settle({ error: new Error(f.message ?? 'STT stream failed') }); return }
          if (f.type === 'ready') {
            clearTimeout(openingTimer)
            if (!ready) {
              ready = true
              resolveOpen()
              for (const c of buffered) sendBytes(c)
              buffered = []
            }
            return
          }
          const incoming = ((f.last ?? f.text ?? '') as string).trim()
          // Only advance `lastText` on real words; a `""` reset/partial must not
          // erase the live transcript (echo) or the turn final.
          if (incoming !== '') lastText = incoming
          if (f.type === 'transcript' || f.ended) settle({ text: incoming !== '' ? incoming : lastText })
          else for (const h of partialHandlers) h(lastText)
        } catch { /* ignore a malformed line */ }
      }
      ws.onclose = () => {
        signal?.removeEventListener('abort', cancel)
        clearTimeout(openingTimer)
        rejectOpen(new Error('STT connection closed before readiness'))
        if (completed === undefined) settle({ error: new Error('STT connection closed before finalization') })
      }
      const cancel = (): void => {
        clearTimeout(openingTimer)
        fail(new Error('STT connection canceled'))
        ws.close()
      }
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
      // Wait for the host's ready frame before returning; a rejection surfaces
      // the failure (the loop then falls back to batch) instead of hanging.
      await open
      return {
        feed(chunk: Uint8Array): void {
          if (finalizing || ws.readyState !== WebSocket.OPEN) { buffered.push(chunk); return }
          for (const c of buffered) sendBytes(c)
          buffered = []
          sendBytes(chunk)
        },
        onPartial(handler: (text: string) => void): void { partialHandlers.push(handler) },
        async end(): Promise<string> {
          finalizing = true
          const result = completed
          completed = undefined
          const pending = result === undefined ? new Promise<Final>((resolve) => {
            settleFinal = resolve
            if (ws.readyState !== WebSocket.OPEN) settle({ error: new Error('STT connection is closed') })
            else {
              try { ws.send(JSON.stringify({ type: 'finalize' })) }
              catch { settle({ error: new Error('STT finalization request failed') }) }
            }
          }) : Promise.resolve(result)
          const final = await pending
          lastText = ''
          finalizing = false
          if ('error' in final) throw final.error
          for (const chunk of buffered) sendBytes(chunk)
          buffered = []
          return final.text
        },
        close(): void {
          signal?.removeEventListener('abort', cancel)
          clearTimeout(openingTimer)
          ws.close()
        },
      }
    },

    resetConversation(): void { host.cancelPreparation?.(); currentConversation = undefined },
    prepareConversation(text, sessionId, speechState): void {
      if (speechState !== cueSpeechState) { playback.stopCue(); cueSpeechState = speechState ?? 'speaking' }
      conversationFor(sessionId).prepare(text, (cue, started) => playback.cue(cue, undefined, started), speechState)
    },
    finishPreparation(): void { currentConversation?.model.finishPreparation(); playback.stopCue() },
    cancelPreparation(): void { currentConversation?.model.cancelPreparation(); playback.stopCue() },
    async conversation(text, sessionId, kind, emit, signal, requestEnd): Promise<string> {
      host.finishPreparation?.()
      return conversationFor(sessionId).run(text, kind === 'application-result' ? 'coding-result' : kind, emit, signal, requestEnd)
    },
    ttsStream: (texts, onStart, signal, sessionId) => playTexts(texts, onStart, signal, true, sessionId),

    async recordExchange(sessionId: string, user: string, assistant: string): Promise<void> {
      if (!deps.getConfig().transcriptHistory) return
      const connection = ctx.get('connection')
      if (connection === undefined) throw new Error('Voice connection unavailable')
      const result = await connection.rpc.call('/voice-pipeline', 'exchange', { sessionId, user, assistant })
      if (!result.ok) throw new Error('Voice transcript could not be saved')
    },

    async openTranscriptEcho(sessionId: string): Promise<TranscriptEcho | null> {
      // Begin a submission echo now (empty text), so the interim transcript
      // paints into the message history as the user speaks. The echo carries
      // the requestId the eventual prompt must reuse; updateSubmissionText
      // mutates the bubble's text live, and commit() sends the identified
      // prompt (retiring the echo once the durable user/message is visible).
      const session = sessionFor(sessionId)
      if (session === undefined) return null
      const handle = session.beginSubmission({ text: '', mode: 'queue', images: [] })
      return {
        update(text: string): void {
          session.updateSubmissionText(handle.requestId, text)
        },
        async commit(text: string): Promise<void> {
          session.updateSubmissionText(handle.requestId, text)
          const result = await session.prompt([{ type: 'text', text }], 'queue', undefined, handle.requestId)
          if (!result.ok) {
            handle.abandon()
            const msg = typeof result.error === 'string' ? result.error : result.error?.message ?? 'voice echo commit failed'
            throw new Error(msg)
          }
        },
        abandon(): void {
          handle.abandon()
        },
      }
    },

    async prompt(sessionId: string, text: string, mode: 'queue' | 'steer'): Promise<void> {
      const session = sessionFor(sessionId)
      if (session === undefined) throw new Error(`voice: no session binding for "${sessionId}"`)
      // Begin a submission echo so the spoken transcript paints into the
      // conversation immediately (the optimistic message), then send the
      // prompt carrying the same identity. The echo retires when the durable
      // `user/message` (with this requestId) becomes visible — so the user's
      // message appears the moment they finish speaking, not after the agent
      // has produced its reply.
      const handle = session.beginSubmission({ text, mode, images: [] })
      const result = await session.prompt([{ type: 'text', text }], mode, undefined, handle.requestId)
      if (!result.ok) {
        handle.abandon()
        const msg = typeof result.error === 'string' ? result.error : result.error?.message ?? 'voice prompt failed'
        throw new Error(msg)
      }
    },

    onReply(sessionId: string, handler: (text: string) => void, onCancelled?: () => void): () => void {
      const source = ctx.sessions.binding(sessionId as SessionId)?.eventSource
      if (source === undefined) return () => {}
      let lastSeq = -1
      let primed = false
      const pending = new Map<number, string>()
      const scan = (): void => {
        for (const entry of source.getSnapshot().entries) {
          if (entry.type !== 'event' || entry.event.seq <= lastSeq) continue
          const event = entry.event
          lastSeq = event.seq
          if (event.type === 'assistant/message') {
            pending.set(event.data.turn, assistantText(event))
          } else if (event.type === 'turn/end') {
            const text = pending.get(event.data.turn)
            pending.delete(event.data.turn)
            if (!primed) continue
            if (event.data.reason.kind === 'completed') {
              if (text) handler(text)
            } else if (event.data.reason.kind === 'aborted' || event.data.reason.kind === 'interrupted') {
              onCancelled?.()
            }
          }
        }
        primed = true
      }
      const unsubscribe = source.subscribe(scan)
      scan()
      return unsubscribe
    },

    async readBackLastOutput(sessionId: string): Promise<string | null> {
      // "Read back the last output" (Flutter `DshAdapter.lastCodeOutput`
      // parity): prefer the host's durable last-output store (written on every
      // spoken reply, so it survives a reload), else scan the session's stored
      // events from the tail for the most recent assistant/message or
      // tool/result text. Return it WITHOUT sending a prompt — so the agent
      // never redoes the work. The loop speaks the result.
      const stored = await readLastOutputRemote(sessionId)
      if (stored !== '') return stored
      const binding = ctx.sessions.binding(sessionId as SessionId)
      const source = binding?.eventSource
      if (source === undefined) return null
      const entries = source.getSnapshot().entries
      let latest = ''
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        if (entry === undefined || entry.type !== 'event') continue
        const event = entry.event as { type: string; data?: AssistantMessageEventData }
        if (event.type !== 'assistant/message' && event.type !== 'tool/result') continue
        const text = lastOutputText(event)
        if (text !== '') {
          latest = text
          break
        }
      }
      return latest === '' ? null : latest
    },

    async tts(text: string, onStart?: () => void, sessionId?: string): Promise<void> {
      try { await playTexts([text], onStart, undefined, false, sessionId) }
      catch (error) { if (!ttsCut) throw error }
    },

    /** Cut the in-flight TTS playback (barge-in), stopping the read loop. */
    async stopTts(): Promise<void> {
      ttsCut = true
      playback.stop()
    },

    async unlock(): Promise<void> {
      await playback.unlock()
    },

    async rewriteReply(text: string, sessionKey?: string): Promise<string> {
      const c = deps.getConfig()
      const trimmed = text.trim()
      if (trimmed === '') return ''
      if (sessionKey !== undefined) void writeLastOutputRemote(sessionKey, trimmed)
      const rewritten = await conversationalRewrite(c, trimmed, false, sessionKey)
      return rewritten
    },

    /**
     * The voice gatekeeper (Flutter `AckRouter` parity): decide whether a decoded
     * utterance must be forwarded to the coding agent, answered from spoken
     * memory, repeated, or read back. Uses the configured conversational model.
     * The host resolves the session model when the conversational model is not configured.
     */
    async decideUtterance(text: string, sessionKey?: string): Promise<VoiceAckDecision> {
      const forwardFallback: VoiceAckDecision = {
        forward: true, reply: null, answer: null, repeatLast: false, readBackOutput: false,
      }
      const c = deps.getConfig()
      try {
        const decision = await ackRouterDecide(c, text, sessionKey)
        return decision
      } catch {
        return forwardFallback
      }
    },
  }

  return {
    host,
    unlock: async () => { await playback.unlock() },
    closeAudio: async () => { host.cancelPreparation?.(); await playback.close() },
    probe: async () => {
      const engine = deps.getSttEngine()
      const res = await fetch(deps.healthRoute, {
        headers: { ...keyHeaders(engine), 'X-STT-Engine': engine, 'X-STT-Silence-Sec': String(deps.getConfig().vadSilenceSec) },
        signal: AbortSignal.timeout(deps.getConfig().stsConnectTimeoutMs + 1000),
      })
      if (!res.ok) throw new Error(`voice-health HTTP ${res.status}`)
      return res.json() as Promise<SttHealth>
    },
    probeConversational: () => probeConversational(deps.getConfig()),
    listConversationalModels: async () => {
      const c = deps.getConfig()
      const catalog = await listConversationalModels(c.conversationalProvider)
      if (c.conversationalProvider !== 'custom' || !c.conversationalBaseUrl.trim() || !c.conversationalCredential) return catalog
      const custom = await listConversationalModels(conversationalRoute(c))
      return { ...custom, providers: catalog.providers ?? [] }
    },
  }
}

/** The wired voice controller for one live session. */
export interface VoiceController {
  /** The underlying loop (feed/test seam). */
  readonly loop: VoiceLoop
  /** The mic capture handle. */
  readonly mic: MicHandle
  /** Acquire the mic and arm the loop bound to one session. */
  start(sessionId: string): Promise<void>
  /** Stop capture and disarm the loop (back to idle). */
  stop(): void
  /** Probe the selected STT provider’s connectivity/auth through the host (no mic, no session). */
  readonly probe: () => Promise<SttHealth>
  /** Probe the configured conversational model (reachability + key + model). */
  readonly probeConversational: () => Promise<ConversationalHealth>
  /** List the configured endpoint's advertised models (provider model picker). */
  readonly listConversationalModels: () => Promise<ConversationalModels>
  /** Synthesize a fixed phrase through the host TTS route (no mic, no session). */
  readonly testTts: (text: string) => Promise<void>
  /** Recover and speak the last agent output through the normal conversational
   * route. Reads it from the persisted session (so it works after a reload),
   * falling back to the in-memory last reply, and rewrites it when the
   * conversational reply is enabled before speaking. */
  readonly readBackOutput: (sessionId: string) => Promise<void>
}

/**
 * Wire the mic, the loop, and the DSH transport into one controller bound to
 * whatever session `start` is called with.
 * @param ctx - client root context.
 * @param deps - live key + routes + mute/read-back reads.
 * @param store - the shared runtime store the loop publishes to.
 */
export function attachVoiceLoop(
  ctx: ClientContext,
  deps: VoiceDeps,
  store: VoiceRuntimeStore,
  opts: VoiceLoopOptions = {},
): VoiceController {
  const { host, unlock, closeAudio, probe, probeConversational, listConversationalModels } = buildDshTransport(ctx, deps)
  const loop = buildVoiceLoop(
    host,
    store,
    () => {
      const c = deps.getConfig()
      return {
        muted: deps.isMuted(),
        readBack: true,
        vadSilenceSec: c.vadSilenceSec,
        voiceStandbySec: c.voiceStandbySec,
        statusSounds: c.statusSounds,
        backchannelEnabled: c.backchannelEnabled,
        conversationalEnabled: c.conversationalEnabled,
      }
    },
    opts,
  )
  const mic = createMicCapture(pcm16 => loop.feed(pcm16))
  let captureGeneration = 0
  let releasingAudio: Promise<void> | undefined
  host.startCapture = async () => {
    const generation = ++captureGeneration
    if (releasingAudio !== undefined) await releasingAudio
    if (generation !== captureGeneration) return
    await Promise.all([mic.unlock(), unlock()])
    if (generation === captureGeneration) await mic.start()
  }
  host.stopCapture = () => {
    captureGeneration++
    releasingAudio = Promise.all([mic.stop(), closeAudio()]).then(() => {})
    void releasingAudio.catch(() => { /* A device already closing cannot prevent local capture teardown. */ })
  }


  const controller: VoiceController = {
    loop,
    mic,
    probe,
    probeConversational,
    listConversationalModels,
    async testTts(text: string): Promise<void> {
      await unlock()
      await host.tts(text)
    },
    async readBackOutput(sessionId: string): Promise<void> {
      // Recover the last agent output, most-durable source first. `readBackLastOutput`
      // now prefers the host's SQLite last-output store (written on every spoken
      // reply, so it survives a reload), then the persisted session's event tail
      // (`assistant/message` AND `tool/result`). Last resort is the in-memory
      // `lastReply`. Then route through `rewriteReply` — the SAME gate the live
      // reply path uses — so read-back is rewritten conversationally when on.
      let text = ''
      if (sessionId !== '' && host.readBackLastOutput !== undefined) {
        text = ((await host.readBackLastOutput(sessionId)) ?? '').trim()
      }
      if (text === '') text = store.getSnapshot().lastReply.trim()
      if (text === '') return
      await unlock()
      let toSpeak = text
      if (host.rewriteReply !== undefined) {
        toSpeak = (await host.rewriteReply(text, sessionId)).trim()
      }
      if (toSpeak === '') return
      // Speak through the interruptible reply path (sets the `speaking` phase and
      // arms the barge-in detector) so a barge-in can cut the read-back, exactly
      // like a live reply. Only when the loop is armed (it skips otherwise); if it
      // is not exposed or not armed, fall back to a plain (non-interruptible) tts.
      if (loop.active && loop.speak !== undefined) await loop.speak(toSpeak)
      else await host.tts(toSpeak, undefined, sessionId)
    },
    async start(sessionId: string): Promise<void> {
      await loop.start(sessionId)
    },
    stop(): void {
      // Flutter parity: `VoiceController.stop()` awaits `synthesizer.stop()`,
      // which actively silences audio that is mid-playback — so turning voice
      // off cuts a reply the agent is still speaking, rather than letting it
      // finish buffered audio. `stopTts()` does the same here: it sets the cut
      // flag and silences the playing source(s), breaking the tts read loop.
      if (host.stopTts !== undefined) void host.stopTts().catch(() => {})
      loop.stop()
    },
  }
  host.endConversation = () => controller.stop()
  return controller
}

/** Resolve either an installed provider ID or the explicit custom endpoint. */
function conversationalRoute(c: VoiceConfig): string {
  return c.conversationalProvider === 'custom' ? c.conversationalBaseUrl.trim().replace(/\/+$/, '') : c.conversationalProvider
}

/** Resolve the requested reasoning effort from the thinking preference. */
export function conversationalReasoningEffort(_c: VoiceConfig): 'none' {
  return 'none'
}

/** Send a conversational request through the installed host provider. */
export async function fetchConversational(url: string, init: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  return fetchViaVoiceHost(url, init, fetchImpl)
}

/** Rewrite `text` through the configured conversational model (OpenAI-compatible chat). */
export async function conversationalRewrite(c: VoiceConfig, text: string, _terse = false, sessionId?: string): Promise<string> {
  const base = conversationalRoute(c)
  const system = `You are a voice assistant summarizing a saved coding report in the user's language. ${spokenResponseInstructions(c.responseDetail)}`
  const res = await fetchConversational(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: c.conversationalModel, voiceSessionId: sessionId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      reasoning_effort: conversationalReasoningEffort(c),
    }),
  })
  if (!res.ok) throw new Error(`conversational rewrite HTTP ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

/** A harmless tool call verifies conversational-model tool support. */
export const CONVERSATIONAL_PROBE_PROMPT = 'Call voice_connection_test once with no arguments.'
/** Completion budget for the connection-test tool call. */
export const CONVERSATIONAL_PROBE_MAX_TOKENS = 200

/** Test credentials, model access and function calling without executing coding work. */
export async function probeConversational(
  c: VoiceConfig,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ConversationalHealth> {
  const base = conversationalRoute(c)
  const model = c.conversationalModel.trim()
  if (base === '' || model === '') {
    return { ok: false, configured: false, message: 'missing provider or model' }
  }
  const started = Date.now()
  const elapsed = (): number => Date.now() - started
  // Bound the request so a non-responsive host is reported, not awaited forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchConversational(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: CONVERSATIONAL_PROBE_PROMPT }],
        tools: [{ type: 'function', function: { name: 'voice_connection_test', description: 'Validate voice connectivity without side effects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }],
        tool_choice: { type: 'function', function: { name: 'voice_connection_test' } },
        max_tokens: CONVERSATIONAL_PROBE_MAX_TOKENS,
        temperature: 0,
        reasoning_effort: conversationalReasoningEffort(c),
      }),
      signal: controller.signal,
    }, fetchImpl)
    if (!res.ok) {
      // Surface the API error body when provided, so a rejected key vs a missing
      // model vs an unknown route are distinguishable at a glance.
      let detail = ''
      try {
        const body = (await res.json()) as { error?: { message?: string } | string }
        const err = body.error
        detail = typeof err === 'string' ? err : err?.message ?? ''
      } catch { /* body was not JSON */ }
      const suffix = detail === '' ? '' : `: ${detail}`
      return { ok: false, message: `HTTP ${res.status}${suffix}`, model, ms: elapsed() }
    }
    const data = (await res.json().catch(() => null)) as { choices?: unknown[] } | null
    if (data === null || !Array.isArray(data.choices) || data.choices.length === 0) {
      return { ok: false, message: 'unexpected response (no choices)', model, ms: elapsed() }
    }
    const choice = data.choices[0] as { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }
    const call = choice?.message?.tool_calls?.[0]?.function
    if (call?.name !== 'voice_connection_test' || call.arguments?.trim() !== '{}') {
      return { ok: false, message: 'Model did not return the required voice tool call', model, ms: elapsed() }
    }
    return { ok: true, message: 'reachable; voice tools supported', model, ms: elapsed() }
  } catch (e) {
    const aborted = (e as { name?: string }).name === 'AbortError'
    return {
      ok: false,
      message: aborted ? `timed out after ${timeoutMs}ms` : (e as Error).message,
      model,
      ms: elapsed(),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** List installed host providers and models eligible for conversational speech.
 * @param baseUrl - selected provider ID; empty while choosing a provider.
 * @param fetchImpl - HTTP transport.
 * @param timeoutMs - catalog request deadline.
 */
export async function listConversationalModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<ConversationalModels> {
  const base = baseUrl.trim().replace(/\/$/, '')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchViaVoiceHost(`${base || 'catalog'}/models`, {
      method: 'GET',
      headers: {

      },
      signal: controller.signal,
    }, fetchImpl)
    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as { error?: { message?: string } | string }
        const err = body.error
        detail = typeof err === 'string' ? err : err?.message ?? ''
      } catch { /* non-JSON body */ }
      const suffix = detail === '' ? '' : `: ${detail}`
      return { ok: false, models: [], message: `HTTP ${res.status}${suffix}` }
    }
    const data = await res.json() as { providers?: NonNullable<ConversationalModels['providers']>; message?: string; data?: { id?: string }[] }
    if (/^https?:\/\//.test(baseUrl)) {
      if (!Array.isArray(data.data)) return { ok: false, models: [], message: 'Endpoint did not return a model list' }
      return { ok: true, models: [...new Set(data.data.flatMap(item => typeof item.id === 'string' && item.id.trim() ? [item.id] : []))] }
    }
    const models = (data.providers ?? []).find(provider => provider.id === baseUrl)?.models.map(model => model.id) ?? []
    return { ok: true, models, providers: data.providers ?? [], ...(data.message ? { message: data.message } : {}) }
  } catch (e) {
    const aborted = (e as { name?: string }).name === 'AbortError'
    return {
      ok: false,
      models: [],
      message: aborted ? `timed out after ${timeoutMs}ms` : (e as Error).message,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The voice gatekeeper prompt, ported from the Flutter app
 * (`lib/src/voice/ack_router.dart` `kAckRouterPrompt`). The model returns a
 * JSON decision `{forward, reply, answer, repeat, readBack}` classifying a
 * spoken utterance: forward it to the agent, acknowledge it, answer it from
 * what was already spoken, repeat the last answer, or read back the last output.
 */
const ACK_ROUTER_PROMPT =
  'You are the voice gatekeeper for a coding assistant. For each spoken ' +
  'message, make two INDEPENDENT decisions: whether the message must be handed ' +
  'to the coding agent, and whether to say a brief acknowledgment out loud.\n\n' +
  'FORWARDING. You cannot see the code, files, build, session state, or recent ' +
  'work, so anything that could concern those must be forwarded: tasks, ' +
  'requests, instructions, corrections, feedback, and status questions (for ' +
  'example "is everything good?", "any errors?", "is it working?"). Forward ' +
  'anything addressed to the assistant about its work, including messages that ' +
  'only introduce what is coming. When in doubt, forward.\n\n' +
  'SPEAKING. ALWAYS acknowledge, unless the message plainly needs no response at ' +
  'all. The user is speaking, not reading: without a spoken reply they cannot ' +
  'tell whether the message was heard, and the agent\'s real answer is seconds ' +
  'away. Silence is the wrong default. What must fit is the WORDING, not whether ' +
  'to speak:\n' +
  '- An instruction to do work ("fix the build", "add a test") gets "On it" or ' +
  '"Doing that now".\n' +
  '- A message that only announces something coming ("I have another thing for ' +
  'you", "let me tell you what I noticed", "you ready?") gets "Go ahead" or ' +
  '"Listening". NEVER claim to be working on it — nothing was asked yet.\n' +
  '- A question gets a brief holding acknowledgment ("Let me check", "One ' +
  'moment") when answering needs work, or a direct answer when you can give ' +
  'one.\n' +
  '- A correction or feedback ("that is wrong", "not like that") gets ' +
  '"Understood" or "Got it". Never "On it".\n' +
  '- Thanks, greetings, or agreement you can answer yourself: reply directly ' +
  '("You\'re welcome", "Hi") and do not forward.\n' +
  '- Only a remark clearly not addressed to the assistant gets null.\n\n' +
  'Never say you are checking, looking into, or working on something unless the ' +
  'message actually asked for work. Never repeat the same acknowledgment twice ' +
  'in a row. Keep any reply under six words.\n\n' +
  'REPEATING. If the message only asks what was just said — "what did you ' +
  'say?", "say that again", "repeat that", "I missed that" — set "repeat" to ' +
  'true, set "forward" to false, and set "reply" to null. The assistant already ' +
  'has its last spoken answer in memory and replays it directly; forwarding ' +
  'would make the agent redo work it has already done.\n\n' +
  'ANSWERING FROM MEMORY. You may be given ALREADY SPOKEN, a list of things ' +
  'the assistant has said aloud, newest last, each tagged with its age. ' +
  'Before forwarding any question, check whether it is already answered there. ' +
  'If it is, put that answer in "answer", set "forward" to false, and set ' +
  '"reply" to null. Answer in your own words, briefly, as speech. This is for ' +
  'recalling what was already said — "which file was that?", "how many did you ' +
  'find?", "what was the version number?", "what did you say the error was?". ' +
  'Do NOT answer from memory when:\n' +
  '- the question asks about the CURRENT state of anything — whether the build ' +
  'passes now, whether a task is done, what the code says now. State changes; a ' +
  'spoken line from minutes ago is not evidence about now. Forward it.\n' +
  '- the answer is old enough that it may no longer hold.\n' +
  '- the message asks for any work, however small.\n' +
  '- you are not certain the answer is really there. Do not infer, guess, or ' +
  'stitch together a plausible answer. If it is not plainly stated, forward.\n' +
  'When answering from memory is right it saves the user several seconds and ' +
  'stops the agent redoing work. When it is wrong it states something stale as ' +
  'fact, which is much worse. So when in doubt, forward.\n\n' +
  'READING BACK. If the message only asks to hear the last code or tool output ' +
  'again, set "readBack" to true, set "forward" to false, and set "reply" to null.\n\n' +
  'Reply with ONLY a JSON object: "forward", "reply", "answer", "repeat", "readBack".'

/** Parse the model's JSON decision; a plain-text reply is a filler with forward. */
export function parseAckDecision(content: string): VoiceAckDecision {
  if (content.trim() === '') {
    return { forward: true, reply: null, answer: null, repeatLast: false, readBackOutput: false }
  }
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const jsonText = fenced ? (fenced[1] ?? '').trim() : content.trim()
  try {
    const decoded = JSON.parse(jsonText) as Record<string, unknown>
    if (decoded && typeof decoded === 'object') {
      const rawAnswer = decoded['answer']
      const answer = typeof rawAnswer === 'string' && rawAnswer.trim() !== '' ? rawAnswer.trim() : null
      // An answer drawn from memory settles the utterance, so it must not also
      // be forwarded — otherwise the agent redoes the work the memory existed to avoid.
      const forward = answer !== null ? false : (typeof decoded['forward'] === 'boolean' ? decoded['forward'] : true)
      const rawReply = decoded['reply']
      const reply = typeof rawReply === 'string' && rawReply.trim() !== '' ? rawReply.trim() : null
      return {
        forward,
        reply,
        answer,
        repeatLast: decoded['repeat'] === true,
        readBackOutput: decoded['readBack'] === true,
      }
    }
  } catch {
    // Not JSON: fall through and treat the whole reply as a spoken filler.
  }
  const t = content.trim()
  if (t.toUpperCase() === 'NONE') {
    return { forward: true, reply: null, answer: null, repeatLast: false, readBackOutput: false }
  }
  return { forward: true, reply: t, answer: null, repeatLast: false, readBackOutput: false }
}

/** Decide how to handle a spoken utterance via the configured conversational model. */
export async function ackRouterDecide(c: VoiceConfig, text: string, sessionId?: string): Promise<VoiceAckDecision> {
  const base = conversationalRoute(c)
  const res = await fetchConversational(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: c.conversationalModel, voiceSessionId: sessionId,
      temperature: 0.3,
      reasoning_effort: conversationalReasoningEffort(c),
      messages: [
        { role: 'system', content: ACK_ROUTER_PROMPT },
        { role: 'user', content: text },
      ],
    }),
  })
  if (!res.ok) throw new Error(`ack router HTTP ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content?.trim() ?? ''
  return parseAckDecision(content)
}
