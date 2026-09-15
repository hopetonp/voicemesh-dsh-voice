import { mountVoicePreviewStream } from './voice-preview-stream.ts'
import { z as wireZ } from 'zod'
import { pipelineRecognizer } from './pipeline-recognizer.ts'
import { listGeminiSpeechModels } from './gemini-models.ts'
import { listOpenaiSpeechModels } from './openai-speech-models.ts'
import { readVoiceCredential, credentialedVoiceRequest, voiceCredentialOperation } from './voice-credentials.ts'
import { mountConversationalProxy } from './conversational-proxy.ts'
import { LocalVoice } from './local-voice.ts'
import { mountPipelineTts } from './pipeline-tts.ts'
/**
 * Host-side voice routes.
 *
 * Mounts three routes that keep every Deepgram call host-side (so the browser
 * never hits the Deepgram CORS boundary):
 *   - `POST {path}`          raw PCM16 → `{ text }` (Flux STT)
 *   - `POST {ttsPath}`       `{ text }`   → binary L16 PCM16 (Aura TTS)
 *   - `GET  {healthPath}`    → `{ ok, keyConfigured, message }` connectivity probe
 *
 * All provider keys are resolved from the host credential service. Browser
 * requests carry provider selections, never API keys. Every provider route
 * requires the authenticated Connection before using host credentials.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage } from 'node:http'
import type { ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { WebSocketServer, WebSocket as WsWebSocket, type RawData } from 'ws'
import type {} from '@deepseek-ai/dsh-credentials'
import type { WebSocketLike, WebSocketConnect } from '@voicemesh/composer'
import { buildSynthesizer, FLUX_LISTEN_URL, type TurnStreamingRecognizer, type HttpPost } from '@voicemesh/composer'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import { probeSts } from './sts-probe.ts'
import { probeStt } from './stt-probe.ts'
import { listStsModels } from './sts-models.ts'
import { mountStsLive } from './sts-live.ts'
import { discoverVoices } from './voice-catalog.ts'
import { createPipelineTools } from './pipeline-tools.ts'
import { savePipelineExchange } from './pipeline-transcript.ts'
import { previewVoice } from './voice-preview.ts'

/** Plug-in name. */
export const name = 'voice-host'
/** Host services required. */
export const inject = ['webServer', 'credentials']

/** Required configuration. */
export interface Config {
  /** Exact absolute STT route path. */
  readonly path: string
  /** Exact absolute streaming STT route path (live partial transcripts). */
  readonly sttStreamPath: string
  /** Exact absolute WebSocket STT route path (live partial transcripts, WS transport). */
  readonly sttWsPath: string
  /** Exact absolute TTS route path. */
  readonly ttsPath: string
  /** Exact absolute health route path. */
  readonly healthPath: string
  /** Prefix of the last-output route (matches `path/<session>`). */
  readonly lastOutputPath?: string
  /** Absolute path to the saved-output SQLite database. */
  readonly lastOutputDbPath?: string
  /** Credential reference holding the Deepgram API key. */
  readonly deepgramKey: string
  /** Deadline for conversational provider requests, including streamed responses. */
  readonly conversationalTimeoutMs?: number
  /** Optional native worker package directory. */
  readonly localRuntimePath?: string
  /** Directory containing installed local model packs. */
  readonly localModelsPath?: string
  /** CPU threads per local synthesis worker. */
  readonly localThreads?: number
  /** Idle model retention, in milliseconds. */
  readonly localIdleMs?: number
  /** Local loading and inference deadline, in milliseconds. */
  readonly localTimeoutMs?: number
  /** Maximum duration of an STS connection probe, in milliseconds. */
  readonly stsProbeTimeoutMs?: number
  /** Maximum wait for provider finalization before releasing the sideband. */
  readonly stsCloseTimeoutMs?: number
  /** Deadline for acknowledged Live commands, including queued transmission. */
  readonly stsCommandTimeoutMs?: number
  /** Maximum outstanding Live command acknowledgments. */
  readonly stsMaxPendingCommands?: number
  /** Time before a provider session limit to seek an idle renewal point, in milliseconds. */
  readonly stsRenewalLeadMs?: number
  /** Maximum retained replacement-session text and Live application-context snapshot bytes. */
  readonly stsRenewalContextBytes?: number
  /** Maximum wait for STT finalization after microphone input ends, in milliseconds. */
  readonly sttFinalizeTimeoutMs?: number
  /** Authenticated live STS WebSocket route. */
  readonly stsPath?: string
  /** Maximum wait for delayed Live transcripts or coalesced application updates, in milliseconds. */
  readonly stsContextWaitMs?: number
  /** Quiet interval for Live transcript admission and application updates; capped by the maximum wait. */
  readonly stsContextQuietMs?: number
  /** Development-only raw provider recording; disabled by default and forbidden in production. */
  readonly stsDebugRecording?: boolean
  /** Dedicated immutable STS audio database. */
  readonly stsAudioDbPath?: string
  /** Per-connection queued STS wire bytes. */
  readonly stsMaxQueuedBytes?: number
  /** Aggregate stored STS PCM byte quota. */
  readonly stsMaxStoredBytes?: number
  /** Max audio body the STT route accepts, in bytes. */
  readonly maxBodyBytes: number
}

export const Config: z<Config> = z.object({
  path: z.string().required(),
  sttStreamPath: z.string().required(),
  sttWsPath: z.string().required(),
  ttsPath: z.string().required(),
  healthPath: z.string().required(),
  lastOutputPath: z.string(),
  lastOutputDbPath: z.string(),
  deepgramKey: z.string().role('credential-ref').required(),
  conversationalTimeoutMs: z.number().step(1).min(1000).max(600000).default(120000),
  localRuntimePath: z.string().default(''),
  localModelsPath: z.string().default(''),
  localThreads: z.number().step(1).min(1).max(32).default(2),
  localIdleMs: z.number().step(1).min(0).max(3600000).default(60000),
  localTimeoutMs: z.number().step(1).min(1000).max(300000).default(30000),
  stsCloseTimeoutMs: z.number().step(1).min(100).max(120000).default(5000),
  stsCommandTimeoutMs: z.number().step(1).min(100).max(120000).default(15000),
  stsMaxPendingCommands: z.number().step(1).min(1).max(1024).default(64),
  stsProbeTimeoutMs: z.number().step(1).min(100).max(120000).default(15000),
  sttFinalizeTimeoutMs: z.number().step(1).min(100).max(120000).default(5000),
  stsPath: z.string().default('/voice-sts/live'),
  stsContextWaitMs: z.number().step(1).min(100).max(30000).default(2000),
  stsContextQuietMs: z.number().step(1).min(1).max(30000).default(200),
  stsDebugRecording: z.boolean().default(false),
  stsAudioDbPath: z.string(),
  stsMaxQueuedBytes: z.number().step(1).min(65536).default(2097152),
  stsMaxStoredBytes: z.number().step(1).min(65536).default(536870912),
  maxBodyBytes: z.number().step(1).min(1024).max(Number.MAX_SAFE_INTEGER).required(),
})

/**
 * Dispatch the auth scheme to the right adapter. `Bearer` (xAI Grok) needs a
 * real `Authorization` header, which only the `ws` library can set on the
 * outbound WebSocket (Node's global WebSocket cannot). Everything else (Deepgram
 * `Token`) keeps the proven undici + `sec-websocket-protocol` path.
 */
export function connectNodeWebSocket(
  url: string,
  headers: Record<string, string>,
): WebSocketLike {
  if (/^bearer\s+/i.test(headers['Authorization'] ?? '')) {
    return connectSttWebSocket(url, headers)
  }
  return connectNodeWebSocketUndici(url, headers)
}

/** Connect STT providers with direct authentication headers and immediate disposal.
 * @param url - Provider WebSocket endpoint.
 * @param headers - Provider authentication headers.
 * @returns The ordered provider stream and its readiness promise.
 */
export function connectSttWebSocket(
  url: string,
  headers: Record<string, string>,
): WebSocketLike {
  // `headers` (which carries the Bearer token) is passed straight through to the
  // underlying socket, satisfying xAI's `Authorization: Bearer <key>` contract.
  const ws = new WsWebSocket(url, { headers }) as unknown as {
    on(event: 'open' | 'error' | 'close', cb: (e?: unknown) => void): void
    on(event: 'message', cb: (data: unknown, isBinary: boolean) => void): void
    send(data: string | Uint8Array): void
    close(): void
    terminate(): void
  }
  let readyResolve!: () => void
  let readyReject!: (e: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const msg: ((d: string) => void)[] = []
  const bin: ((d: Uint8Array) => void)[] = []
  const err: ((e: unknown) => void)[] = []
  const close: (() => void)[] = []
  // Bound the open handshake so a bad key fails fast rather than hanging.
  const readyTimer = setTimeout(() => readyReject(new Error('websocket open timed out')), 10_000)
  ws.on('open', () => {
    clearTimeout(readyTimer)
    readyResolve()
  })
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // `ws` delivers binary as a Buffer (or an array of Buffers for fragments).
      const bytes = Array.isArray(data)
        ? Buffer.concat(data as Buffer[])
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer)
      const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      for (const h of bin) h(view)
    } else {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
      for (const h of msg) h(text)
    }
  })
  ws.on('error', (e) => {
    clearTimeout(readyTimer)
    for (const h of err) h(e)
    readyReject(new Error('websocket error'))
  })
  ws.on('close', () => {
    clearTimeout(readyTimer)
    if (process.env.DSH_VOICE_DEBUG === '1') console.log('[voice-provider-ws] closed', { endpoint: new URL(url).pathname })
    for (const h of close) h()
    readyReject(new Error('websocket closed before open'))
  })
  return {
    send: (d) => {
      if (process.env.DSH_VOICE_DEBUG === '1' && typeof d === 'string' && (d === '{"type":"CloseStream"}' || d === '{"type":"audio.done"}')) console.log('[voice-provider-ws] finalize sent', { endpoint: new URL(url).pathname, control: d })
      ws.send(d)
    },
    close: () => { clearTimeout(readyTimer); ws.terminate() },
    ready,
    onMessage: h => msg.push(h),
    onBinary: h => bin.push(h),
    onError: h => err.push(h),
    onClose: h => close.push(h),
  }
}

/** Adapt Node's global WebSocket (undici) to the core's WebSocketLike.
 * Only handles the `Token` (Deepgram) auth scheme; the `Bearer` scheme is
 * dispatched to the `ws`-based adapter below (Node's global WebSocket cannot
 * set a custom request header). */
function connectNodeWebSocketUndici(
  url: string,
  headers: Record<string, string>,
): WebSocketLike {
  // Node's global WebSocket cannot set custom request headers, so forward the
  // Deepgram token as the standard Sec-WebSocket-Protocol subprotocol instead.
  const token = /^token\s+(.+)$/i.exec(headers['Authorization'] ?? '')?.[1]
  const protocols = token === undefined ? undefined : ['token', token]
  const ws = new WebSocket(url, protocols) as unknown as {
    onopen: (() => void) | null
    onmessage: ((ev: { data: unknown }) => void) | null
    onerror: (() => void) | null
    onclose: ((ev: { code: number; wasClean: boolean }) => void) | null
    send(data: unknown): void
    close(): void
  }
  let readyResolve!: () => void
  let readyReject!: (e: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const msg: ((d: string) => void)[] = []
  const bin: ((d: Uint8Array) => void)[] = []
  const err: ((e: unknown) => void)[] = []
  const close: (() => void)[] = []
  // Deepgram rejects a bad key at the WS upgrade; Node's WebSocket sometimes
  // never fires onerror/onclose for that, so `await channel.ready` would hang a
  // recognizer forever. Bound the open handshake: reject `ready` if it does not
  // open in time so a bad key fails fast with a real error instead of hanging.
  const readyTimer = setTimeout(() => readyReject(new Error('websocket open timed out')), 10_000)
  ws.onopen = () => {
    clearTimeout(readyTimer)
    readyResolve()
  }
  ws.onmessage = (ev) => {
    // Deepgram sends text JSON frames (STT TurnInfo, TTS SpeechMetadata) and
    // binary audio frames (streamed TTS). Forward text to onMessage and binary
    // to onBinary so the streaming synthesizer can feed its sink.
    //
    // Node's global WebSocket (undici) delivers binary frames as a Blob, not
    // an ArrayBuffer/typed array — so without this branch the callback falls
    // through and DROPS every TTS audio frame, making read-back silent (0 bytes
    // returned, no error). Flutter's Dart WebSocket gives binary as Uint8List
    // directly, which is why it never hit this.
    const d = ev.data
    if (typeof d === 'string') {
      console.log(`[dg-ws] TEXT ${d.slice(0, 4000)}`)
      for (const h of msg) h(d)
    } else if (d instanceof Blob) {
      void d.arrayBuffer().then((buf) => {
        console.log(`[dg-ws] BINARY ${buf.byteLength} bytes`)
        for (const h of bin) h(new Uint8Array(buf))
      })
    } else if (d instanceof ArrayBuffer) {
      console.log(`[dg-ws] BINARY ${d.byteLength} bytes`)
      for (const h of bin) h(new Uint8Array(d))
    } else if (ArrayBuffer.isView(d)) {
      console.log(`[dg-ws] BINARY ${d.byteLength} bytes`)
      for (const h of bin) h(new Uint8Array(d.buffer, d.byteOffset, d.byteLength))
    }
  }
  ws.onerror = () => {
    if (process.env.DSH_VOICE_DEBUG === '1') console.warn('[voice-provider-ws] transport error', { endpoint: new URL(url).pathname })
    for (const h of err) h(new Error('websocket error'))
    // If the socket errors before it opened (e.g. Deepgram rejects the auth
    // subprotocol for a bad key), `ready` must reject instead of hanging the
    // recognizer on `await channel.ready` forever.
    readyReject(new Error('websocket error'))
  }
  ws.onclose = (event) => {
    if (process.env.DSH_VOICE_DEBUG === '1') console.log('[voice-provider-ws] closed', { endpoint: new URL(url).pathname, code: event.code, clean: event.wasClean })
    for (const h of close) h()
    // A close before the open handshake (bad key / rejected connection) is the
    // common auth-failure path; rejecting `ready` surfaces it promptly. After a
    // successful open the promise is already settled, so this is a no-op.
    readyReject(new Error('websocket closed before open'))
  }
  return {
    send: data => ws.send(data),
    close: () => ws.close(),
    ready,
    onMessage: h => msg.push(h),
    onBinary: h => bin.push(h),
    onError: h => err.push(h),
    onClose: h => close.push(h),
  }
}

/** Minimal request/response shape the route handlers use. */
interface HttpRequest {
  headers: Record<string, string | string[] | undefined>
  on(event: 'data', f: (chunk: Uint8Array) => void): void
  on(event: 'end' | 'close', f: () => void): void
}
interface HttpResponse {
  statusCode: number
  on?(event: 'close', handler: () => void): unknown
  off?(event: 'close', handler: () => void): unknown
  setHeader(name: string, value: string): void
  /** Stream a chunk of the response body (the raw node ServerResponse supports this). */
  write?(chunk: Uint8Array): boolean
  end(body?: string | Uint8Array): void
}

/** Read the first value of a possibly-array header. */
function headerValue(headers: HttpRequest['headers'], name: string): string | undefined {
  const value = headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

/** Read a single query-string parameter value ('' → undefined for a bare key). */
function queryParam(qs: string, name: string): string | undefined {
  for (const pair of qs.split('&')) {
    const eq = pair.indexOf('=')
    if (eq < 0) continue
    if (decodeURIComponent(pair.slice(0, eq)) === name) return decodeURIComponent(pair.slice(eq + 1) || '')
  }
  return undefined
}

/** Accumulate a request body into JSON/text. */
function collectBody(req: HttpRequest): Promise<string> {
  const chunks: string[] = []
  return new Promise((resolve) => {
    req.on('data', (c: Uint8Array) => chunks.push(Buffer.from(c).toString('utf8')))
    req.on('end', () => resolve(chunks.join('')))
  })
}

/** Host-owned persistence for the most recent coding output per session. */
class LastOutputDb {
  private constructor(readonly db: DatabaseSync) {}

  static async open(path: string): Promise<LastOutputDb> {
    mkdirSync(dirname(path), { recursive: true })
    const { DatabaseSync } = await import('node:sqlite') as typeof import('node:sqlite')
    const db = new DatabaseSync(path)
    // Readers and output updates share the database through WAL.
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(`
      CREATE TABLE IF NOT EXISTS last_output (
        session_id TEXT    PRIMARY KEY,
        at_ms      INTEGER NOT NULL,
        text       TEXT    NOT NULL
      );
    `)
    return new LastOutputDb(db)
  }

  getLastOutput(sessionId: string): string {
    const row = this.db
      .prepare('SELECT text FROM last_output WHERE session_id = ?')
      .get(sessionId) as { text: string } | undefined
    return row?.text ?? ''
  }

  setLastOutput(sessionId: string, text: string, atMs = Date.now()): void {
    this.db
      .prepare('INSERT INTO last_output (session_id, at_ms, text) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET at_ms = excluded.at_ms, text = excluded.text')
      .run(sessionId, atMs, text)
  }
}

/** Lazy, memoized access to the store (opened on first use, once per apply). */
function memoDb(open: () => Promise<LastOutputDb>): { get(): Promise<LastOutputDb> } {
  let db: Promise<LastOutputDb> | null = null
  return { get: () => (db ??= open()) }
}

/** Register the STT + TTS + health routes. */
export function apply(ctx: Context, config: Config): void {
  mountConversationalProxy(ctx, config.maxBodyBytes, config.conversationalTimeoutMs ?? 120000)
  const local = new LocalVoice({ runtimePath: config.localRuntimePath ?? '', modelsPath: config.localModelsPath ?? '',
    threads: config.localThreads ?? 2, idleMs: config.localIdleMs ?? 60000, timeoutMs: config.localTimeoutMs ?? 30000 })
  ctx.effect(() => () => local.dispose(), 'voice-host: local model workers')
  ctx.inject(['connection'], (connected) => {
    connected.effect(() => connected.connection.rpc.handle('/voice-credentials', async (endpoint, payload) => {
      try { return { ok: true, value: await voiceCredentialOperation(ctx, endpoint, payload, config.deepgramKey) } }
      catch { return { ok: false, error: { code: 'voice/credentials', message: 'Voice credential operation failed; check host credential settings', details: {} } } }
    }), 'voice-host: credential setup')
    connected.effect(() => connected.connection.rpc.handle('/voice-local', async (endpoint) => {
      if (endpoint !== 'models') return { ok: false, error: { code: 'voice/local', message: 'Unknown local voice operation', details: {} } }
      try {
        const models = await local.models()
        return { ok: true, value: models.map(({ id, name, languages, kind }) => ({ id, name, languages, kind })) }
      } catch (error) { return { ok: false, error: { code: 'voice/local', message: (error as Error).message, details: {} } } }
    }), 'voice-host: local model catalog')
    mountVoicePreviewStream(connected, config.maxBodyBytes, config.stsProbeTimeoutMs ?? 15000,
      config.deepgramKey, connectNodeWebSocket, local)
    const lifetime = new AbortController()
    connected.effect(() => () => { lifetime.abort() }, 'voice-host: STS probe cancellation')
    connected.effect(() => connected.connection.rpc.handle('/voice-sts',
      async (endpoint, payload, signal) => {
        if (endpoint === 'voices' && typeof payload === 'object' && payload !== null
          && 'provider' in payload && payload.provider === 'kokoro') {
          try {
            const models = (await local.models()).filter(model => model.kind === 'tts')
            return { ok: true, value: {
              voices: models.flatMap(model => model.voices.map(voice => ({ ...voice, id: `${model.id}:${voice.id}`, description: model.name }))),
              source: 'documentation', sourceUrl: models[0]?.sourceUrl ?? 'https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/kokoro.html',
              fetchedAt: new Date().toISOString(),
            } }
          } catch (error) { return { ok: false, error: { code: 'voice/local', message: (error as Error).message, details: {} } } }
        }
        if (endpoint === 'voices' || endpoint === 'voice-preview') {
          try {
            const deadline = config.stsProbeTimeoutMs ?? 15000
            const ownedSignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(deadline)])
            const value = endpoint === 'voices' ? await discoverVoices(await credentialedVoiceRequest(ctx, payload, config.deepgramKey), ownedSignal, config.maxBodyBytes)
              : await previewVoice(typeof payload === 'object' && payload !== null && 'provider' in payload && payload.provider === 'kokoro'
                ? payload : await credentialedVoiceRequest(ctx, payload, config.deepgramKey),
              ownedSignal, config.maxBodyBytes, deadline, connectNodeWebSocket, undefined, local)
            return { ok: true, value }
          } catch {
            return { ok: false, error: { code: 'voice/catalog', message: 'Voice discovery or preview failed', details: {} } }
          }
        }
        if (endpoint === 'pipeline-models') {
          try {
            const input = wireZ.object({ provider: wireZ.enum(['openai', 'gemini']).default('openai'), kind: wireZ.enum(['stt', 'tts']) }).strict().parse(payload)
            const key = await readVoiceCredential(ctx, `${input.provider}-sts`)
            if (!key) throw new Error('Speech credential is not configured')
            const models = await (input.provider === 'gemini' ? listGeminiSpeechModels : listOpenaiSpeechModels)(key, input.kind, AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(config.stsProbeTimeoutMs ?? 15000)]))
            return { ok: true, value: { models } }
          } catch { return { ok: false, error: { code: 'voice/models', message: 'Speech model discovery failed', details: {} } } }
        }
        if (endpoint === 'models') {
          try {
            const discoverySignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(config.stsProbeTimeoutMs ?? 15000)])
            const models = await listStsModels(await credentialedVoiceRequest(ctx, payload, config.deepgramKey), discoverySignal)
            return { ok: true, value: { models } }
          } catch {
            // Provider responses and validation errors can contain credentials.
            return { ok: false, error: { code: 'voice/sts/models', message: 'STS model discovery failed', details: {} } }
          }
        }
        if (endpoint !== 'probe') return { ok: false, error: { code: 'voice/sts/not-found', message: 'Unknown STS endpoint', details: {} } }
        try {
          const ok = await probeSts(await credentialedVoiceRequest(ctx, payload, config.deepgramKey),
            AbortSignal.any([signal, lifetime.signal]), config.stsProbeTimeoutMs ?? 15000)
          return { ok: true, value: { ready: ok } }
        } catch {
          // RPC validation and cancellation errors exclude request credentials from diagnostics.
          return { ok: false, error: { code: 'voice/sts/probe', message: 'STS connection test failed', details: {} } }
        }
      }), 'voice-host: authenticated STS probe')
  })
  const lastOutputPath = config.lastOutputPath ?? '/api/voice/last-output'
  const lastOutputDbPath = config.lastOutputDbPath ?? join(homedir(), '.dsh', 'voice-spoken-memory.sqlite')
  ctx.inject(['connection', 'sessionController', 'sessions'], (connected) => {
    mountPipelineTts(connected, `${config.ttsPath}/stream`, connect, config.stsMaxQueuedBytes ?? 1048576, config.stsProbeTimeoutMs ?? 15000, config.deepgramKey)
    const pipelineTool = createPipelineTools(connected)
    connected.effect(() => connected.connection.rpc.handle('/voice-pipeline', async (endpoint, payload, signal) => {
      if (endpoint === 'tool') {
        try { return { ok: true, value: await pipelineTool(payload, signal) } }
        catch (error) { return { ok: false, error: { code: 'voice/tool', message: (error as Error).message, details: {} } } }
      }
      if (endpoint !== 'exchange') return { ok: false, error: { code: 'voice/history/not-found', message: 'Unknown voice history endpoint', details: {} } }
      try {
        await savePipelineExchange(connected, payload, signal)
        return { ok: true, value: null }
      } catch {
        return { ok: false, error: { code: 'voice/history', message: 'Voice transcript could not be saved', details: {} } }
      }
    }), 'voice-host: pipeline transcript persistence')
    mountStsLive(connected, {
      path: config.stsPath ?? '/voice-sts/live',
      debugRecording: config.stsDebugRecording ?? false,
      audioDbPath: config.stsAudioDbPath ?? join(dirname(lastOutputDbPath), 'voice-sts-audio.sqlite'),
      connectTimeoutMs: config.stsProbeTimeoutMs ?? 15000,
      closeTimeoutMs: config.stsCloseTimeoutMs ?? 5000,
      contextWaitMs: config.stsContextWaitMs ?? 2000,
      contextQuietMs: config.stsContextQuietMs ?? 200,
      commands: { timeoutMs: config.stsCommandTimeoutMs ?? 15000, maxPending: config.stsMaxPendingCommands ?? 64 },
      renewalLeadMs: config.stsRenewalLeadMs ?? 120000,
      renewalContextBytes: config.stsRenewalContextBytes ?? 32768,
      maxQueuedBytes: config.stsMaxQueuedBytes ?? 2097152,
      maxStoredBytes: config.stsMaxStoredBytes ?? 536870912,
    })
  })
  const connect: WebSocketConnect = connectNodeWebSocket
  const localRejection = (req: HttpRequest): 401 | 403 | undefined => {
    const connection = ctx.get('connection')
    return connection ? connection.requestRejection(req) : 401
  }
  const engineNeedsXai = (engine: string): boolean => engine === 'grok'
  const keyFor = async (_req: HttpRequest, engine: string): Promise<string | null> => {
    if (engine === 'vosk' || engine === 'kokoro') return null
    if (engine === 'openai' || engine === 'gemini') return readVoiceCredential(ctx, `${engine}-sts`)
    if (engine === 'fish') return readVoiceCredential(ctx, 'fish')
    if (engineNeedsXai(engine)) return readVoiceCredential(ctx, 'xai')
    return readVoiceCredential(ctx, 'deepgram', undefined, config.deepgramKey)
  }
  const wsKeyFor = keyFor

  const sttRoute = {
    kind: 'exact' as const,
    path: config.path,
    handler: async (req: HttpRequest, res: HttpResponse): Promise<void> => {
      const chunks: Uint8Array[] = []
      req.on('data', (c: Uint8Array) => chunks.push(c))
      req.on('end', async () => {
        const length = chunks.reduce((s, c) => s + c.length, 0)
        if (length > config.maxBodyBytes) {
          res.statusCode = 413
          res.end('{}')
          return
        }
        const body = new Uint8Array(length)
        let at = 0
        for (const c of chunks) {
          body.set(c, at)
          at += c.length
        }
        // The engine id selects the provider through the core factory (Deepgram
        // Flux is the first implementation). A missing/blank header — or the
        // literal "undefined"/"null" a legacy client sends when its config never
        // gained the engine field — silently defaults to Flux rather than 400ing.
        const rawEngine = (headerValue(req.headers, 'x-stt-engine') ?? '').trim()
        const sttEngine = rawEngine === '' || rawEngine === 'undefined' || rawEngine === 'null'
          ? 'deepgram-flux'
          : rawEngine
        const rejection = localRejection(req)
        if (rejection) { res.statusCode = rejection; res.end('{}'); return }
        const key = await keyFor(req, sttEngine)
        if (key === null && sttEngine !== 'vosk') {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, text: '', error: `no ${sttEngine === 'gemini' ? 'Gemini' : sttEngine === 'openai' ? 'OpenAI' : sttEngine === 'fish' ? 'Fish Audio' : engineNeedsXai(sttEngine) ? 'xAI' : 'Deepgram'} key available` }))
          return
        }
        const recognizer = sttEngine === 'vosk' ? local.recognizer(headerValue(req.headers, 'x-stt-model') ?? '')
          : pipelineRecognizer(sttEngine, connectSttWebSocket, () => key, headerValue(req.headers, 'x-stt-model'))
        if (recognizer === null) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, text: '', error: `unsupported STT engine: ${sttEngine}` }))
          return
        }
        try {
          const t0 = Date.now()
          const text = (await recognizer.transcribe(body)).trim()
          console.log(`[voice-stt] ${text.length} chars in ${Date.now() - t0}ms (${body.length} bytes audio): ${text.slice(0, 4000)}`)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, text }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ ok: false, text: '', error: (e as Error).message }))
        }
      })
    },
  }

  // Streaming STT: the browser POSTs a live PCM16 stream as the request body
  // and reads `application/x-ndjson` frames back as the transcript forms.
  // Each `{type:'partial'|'transcript', text, ended}` line is a Flux TurnInfo
  // delivered the moment Deepgram produces it, so the user sees their words
  // as they speak instead of a single batch result after they stop.
  const sttStreamRoute = {
    kind: 'exact' as const,
    path: config.sttStreamPath,
    handler: async (req: HttpRequest, res: HttpResponse): Promise<void> => {
      const rejection = localRejection(req)
      if (rejection) { res.statusCode = rejection; res.end('{}'); return }
      const key = await keyFor(req, 'deepgram-flux')
      if (key === null) {
        console.log('[voice-stt-stream] no key, 400')
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/x-ndjson')
        res.end('{"type":"transcript","text":"","ended":true}\n')
        return
      }
      const dg = connect(FLUX_LISTEN_URL, { Authorization: `Token ${key}` })
      let closed = false
      console.log('[voice-stt-stream] connect opened')
      try {
        await dg.ready
      } catch (e) {
        console.log('[voice-stt-stream] connect FAILED:', (e as Error).message)
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/x-ndjson')
        res.end('{"type":"transcript","text":"","ended":true}\n')
        return
      }
      console.log('[voice-stt-stream] ready — streaming')
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/x-ndjson')
      res.setHeader('Cache-Control', 'no-cache')
      let lastText = ''
      let frameCount = 0
      const writeFrame = (body: string): void => {
        if (!closed && res.write !== undefined) {
          frameCount += 1
          if (frameCount === 1 || frameCount % 5 === 0) {
            console.log(`[voice-stt-stream] frame#${frameCount} ${body.slice(0, 120)}`)
          }
          res.write(Buffer.from(body))
        }
      }
      dg.onMessage((data) => {
        let frame: Record<string, unknown>
        try {
          frame = JSON.parse(data) as Record<string, unknown>
        } catch {
          return
        }
        if (frame['type'] !== 'TurnInfo') return
        const event = frame['event'] as string | undefined
        const t = (frame['transcript'] as string | undefined ?? '').trim()
        if (t !== '') lastText = t
        const ended = event === 'EndOfTurn' || event === 'EagerEndOfTurn'
        writeFrame(`${JSON.stringify({
          type: ended ? 'transcript' : 'partial',
          text: t,
          ended,
          last: lastText,
        })}\n`)
      })
      let pending: Uint8Array[] = []
      let opened = false
      dg.onClose(() => {
        closed = true
        res.end()
      })
      dg.onBinary?.(() => { /* audio is down-stream only; ignore */ })
      dg.onError((_e) => {
        closed = true
        res.end()
      })
      req.on('data', (c: Uint8Array) => {
        if (opened) dg.send(c)
        else pending.push(c)
      })
      req.on('end', () => {
        console.log(`[voice-stt-stream] req end: ${pending.length} pending bytes + stream`)
        // Flush queued audio, then signal Deepgram the turn is done.
        for (const c of pending) dg.send(c)
        pending = []
        opened = true
        dg.send(JSON.stringify({ type: 'CloseStream' }))
      })
      req.on('close', () => {
        console.log(`[voice-stt-stream] req close (frames=${frameCount})`)
        closed = true
        dg.close()
      })
    },
  }

  // WebSocket streaming STT: the browser cannot stream an upload body via
  // `fetch` (Chrome rejects `duplex:'half'` request bodies), so audio travels
  // up a WebSocket instead. The browser sends binary PCM16 frames; the host
  // forwards them to Deepgram's Flux live listen socket and streams the interim
  // transcripts back as NDJSON text "frames" — so the user sees their words
  // as they speak, in every browser.
  const sttWsServer = new WebSocketServer({ noServer: true })
  const sttWsRoute: WebUpgradeRoute = {
    path: config.sttWsPath,
    handler: async (req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
      // The engine id comes from the URL (the browser appends `&engine=grok`
      // when the user selects Grok STT); default is Deepgram Flux.
      const engine = queryParam((req.url ?? '').split('?')[1] ?? '', 'engine') ?? 'deepgram-flux'
      const rejection = localRejection(req)
      if (rejection) { socket.end(`HTTP/1.1 ${rejection} Rejected\r\nConnection: close\r\n\r\n`); return }
      const key = await wsKeyFor(req, engine)
      if (key === null && engine !== 'vosk') {
        socket.end([
          'HTTP/1.1 401 Unauthorized',
          'Connection: close',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Length: 9',
          '',
          'no key',
        ].join('\r\n'))
        return
      }
      sttWsServer.handleUpgrade(req, socket, head, async (ws) => {
        sttWsServer.emit('connection', ws, req)
        // A single browser↔host WebSocket serves the whole session. The vendor
        // leg is driven by the core's Flutter-equivalent TurnStreamingRecognizer
        // (buildRecognizer → turnStream): one socket, reactive staged turns. The
        // host forwards the browser's PCM chunks into the recognizer's input and
        // relays its staged turns back as partial/transcript frames.
        let closed = false
        let frameCount = 0
        const sendFrame = (body: string): void => {
          if (closed || ws.readyState !== WsWebSocket.OPEN) return
          frameCount += 1
          if (frameCount === 1 || frameCount % 5 === 0) {
            console.log(`[voice-stt-ws] frame#${frameCount} ${body.slice(0, 120)}`)
          }
          ws.send(body)
        }

        // The recognizer selected by the engine id (Deepgram Flux by default).
        const recognizer = engine === 'vosk' ? local.recognizer(queryParam((req.url ?? '').split('?')[1] ?? '', 'model') ?? '')
          : pipelineRecognizer(engine, connectSttWebSocket, () => key, queryParam((req.url ?? '').split('?')[1] ?? '', 'model') ?? '')
        if (recognizer === null) {
          ws.close(1011, 'unsupported STT engine')
          return
        }
        const turnRec = recognizer as TurnStreamingRecognizer

        // One turnStream per browser turn: Deepgram does not auto-EndOfTurn on a
        // discrete feed, so a turn is finalized on the browser's `finalize` signal
        // (which completes the input → the recognizer sends CloseStream → the
        // definitive transcript returns), then a fresh turnStream starts for the
        // next utterance. The Deepgram wire protocol stays in the core adapter.
        let turnActive = false
        let inputQueue: Uint8Array[] = []
        let inputWaiter: (() => void) | null = null
        let endCurrent: (() => void) | null = null
        let cancelCurrent: (() => void) | null = null

        const startTurn = (): void => {
          if (closed || turnActive) return
          turnActive = true
          const seed = inputQueue
          inputQueue = []
          let done = false
          const startedAt = performance.now()
          const abort = new AbortController()
          let deadline: ReturnType<typeof setTimeout> | undefined
          let failed = false
          const finish = (): void => {
            done = true
            const w = inputWaiter
            inputWaiter = null
            w?.()
          }
          endCurrent = () => {
            if (!done) deadline = setTimeout(() => { abort.abort(new Error('STT finalization timed out')) }, config.sttFinalizeTimeoutMs ?? 5000)
            finish()
          }
          cancelCurrent = () => { finish(); abort.abort() }
          const input = (async function* (): AsyncIterable<Uint8Array> {
            for (const c of seed) yield c
            while (!done || inputQueue.length > 0) {
              if (inputQueue.length > 0) yield inputQueue.shift() as Uint8Array
              else await new Promise<void>((resolve) => { inputWaiter = resolve })
            }
          })()
          void (async () => {
            // Provider adapters emit cumulative text for the browser utterance.
            const debug = process.env.DSH_VOICE_DEBUG === '1'
            let last = ''
            try {
              for await (const turn of turnRec.turnStream(input, abort.signal)) {
                if (closed) return
                const stage = turn.stage
                const t = (turn.transcript ?? '').trim()
                if (t !== '') last = t
                if (debug) console.log(`[voice-stt-ws] stage=${stage} raw=${JSON.stringify(t)} last=${JSON.stringify(last)}`)
                sendFrame(JSON.stringify({ type: 'partial', text: last, ended: false, last: last }) + '\n')
              }
            } catch (e) {
              failed = true
              if (debug) console.warn('[voice-stt-ws] failed', { engine, elapsedMs: Math.round(performance.now() - startedAt), finalizing: done, timedOut: abort.signal.aborted, message: (e as Error).message })
              if (!closed) sendFrame(JSON.stringify({ type: 'error', message: abort.signal.aborted ? 'STT finalization timed out' : (e as Error).message }))
            } finally {
              // The turn ended (finalize) or errored: commit the definitive final.
              clearTimeout(deadline)
              finish()
              turnActive = false
              endCurrent = null
              cancelCurrent = null
              if (!closed && !failed) {
                const finalText = last.trim()
                sendFrame(JSON.stringify({ type: 'transcript', text: finalText, ended: true, last: finalText }) + '\n')
              }
            }
          })()
        }

        console.log('[voice-stt-ws] open')
        // Signal the browser immediately: its audio is queued here and flushed into
        // the recognizer once its Deepgram socket is open, so the first words are
        // never lost during the connect handshake.
        sendFrame(JSON.stringify({ type: 'ready' }) + '\n')
        startTurn()

        ws.on('message', (data: RawData, isBinary: boolean) => {
          if (closed) return
          if (!isBinary) {
            // A `finalize` message ends the current turn: the recognizer sends
            // CloseStream, Deepgram returns the definitive final, and a fresh
            // turnStream starts for the next utterance.
            try {
              const msg = JSON.parse(String(data)) as { type?: string }
              if (msg.type === 'finalize') endCurrent?.()
            } catch { /* not our control frame */ }
            return
          }
          // Binary audio.
          const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
          if (!turnActive) startTurn()
          inputQueue.push(new Uint8Array(bytes))
          const w = inputWaiter
          inputWaiter = null
          w?.()
        })
        ws.on('close', () => {
          closed = true
          cancelCurrent?.()
          recognizer.dispose()
        })
      })
    },
  }

  const ttsRoute = {
    kind: 'exact' as const,
    path: config.ttsPath,
    handler: async (req: HttpRequest, res: HttpResponse): Promise<void> => {
      res.setHeader('Content-Type', 'application/json')
      const body = JSON.parse(await collectBody(req)) as { text?: unknown; voice?: unknown; engine?: unknown; model?: unknown }
      const text = body.text
      if (typeof text !== 'string' || text.trim() === '') {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: 'text is required' }))
        return
      }
      const voice = typeof body.voice === 'string' && body.voice.trim() !== '' ? body.voice.trim() : undefined
      const ttsEngine = (typeof body.engine === 'string' && body.engine.trim() !== '') ? body.engine.trim() : 'deepgram'
      const rejection = localRejection(req)
      if (rejection) { res.statusCode = rejection; res.end('{}'); return }
      const key = await keyFor(req, ttsEngine)
      if (key === null && ttsEngine !== 'kokoro') {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, error: `no ${ttsEngine === 'gemini' ? 'Gemini' : ttsEngine === 'openai' ? 'OpenAI' : ttsEngine === 'fish' ? 'Fish Audio' : engineNeedsXai(ttsEngine) ? 'xAI' : 'Deepgram'} key available` }))
        return
      }
      // Diagnostic log: which model/engine the browser asked for.
      console.log(`[voice-tts] engine=${ttsEngine} model=${voice ?? '(default)'} text="${text.slice(0, 60)}"`)
      try {
        // Stream the audio to the browser as it is synthesized instead of
        // buffering the whole reply, so read-back starts immediately (Flutter
        // parity — the browser hears the first syllables while the rest streams).
        res.statusCode = 200
        res.setHeader('Content-Type', 'audio/l16')
        let total = 0
        const http: HttpPost = async (url, { headers, body }) => {
          const r = await fetch(url, { method: 'POST', headers, body })
          const bodyBytes = new Uint8Array(await r.arrayBuffer())
          const bodyText = await r.text().catch(() => '')
          return { status: r.status, bodyBytes, body: bodyText }
        }
        const audioSink = (bytes: Uint8Array): void => {
          if (total === 0) res.setHeader('X-Voice-Sample-Rate', String(provider.outputSampleRate))
          total += bytes.length
          res.write?.(bytes)
        }
        const synth = ttsEngine === 'kokoro' ? local.synthesizer(voice ?? '', audioSink)
          : buildSynthesizer(ttsEngine, connect, () => key, http, audioSink, voice, typeof body.model === 'string' ? body.model : undefined)
        if (synth === null) throw new Error(`unsupported TTS engine: ${ttsEngine}`)
        const provider = synth
        const cancel = (): void => synth.stop()
        res.on?.('close', cancel)
        try { await synth.speak(text.slice(0, 2000)) }
        finally { res.off?.('close', cancel); synth.dispose() }
        console.log(`[voice-tts] OK ${total} bytes streamed (model=${voice ?? '(default)'})`)
        res.end()
      } catch (e) {
        console.log(`[voice-tts] FAIL ${(e as Error).message}`)
        res.statusCode = 500
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }))
      }
    },
  }

  const healthRoute = {
    kind: 'exact' as const,
    path: config.healthPath,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const rejection = localRejection(req)
      if (rejection) { res.statusCode = rejection; res.end('{}'); return }
      res.setHeader('Content-Type', 'application/json')
      const engine = headerValue(req.headers, 'x-stt-engine') ?? ''
      if (engine === 'vosk') {
        const rejection = localRejection(req)
        if (rejection) { res.statusCode = rejection; res.end('{}'); return }
        const started = performance.now()
        const recognizer = local.recognizer(headerValue(req.headers, 'x-stt-model') ?? '')
        const abort = new AbortController()
        res.once('close', () => abort.abort())
        try {
          for await (const _turn of recognizer.turnStream((async function* () { yield new Uint8Array(3200) })(),
            AbortSignal.any([abort.signal, AbortSignal.timeout(config.localTimeoutMs ?? 30000)]))) {
            /* Native finalization verifies readiness. */
          }
          res.end(JSON.stringify({
            ok: true, keyConfigured: true, elapsedMs: Math.round(performance.now() - started), message: 'Local recognition ready',
          }))
        } catch (error) {
          res.end(JSON.stringify({
            ok: false, keyConfigured: true, elapsedMs: Math.round(performance.now() - started), message: (error as Error).message,
          }))
        }
        finally { recognizer.dispose() }
        return
      }
      if (engine !== 'deepgram-flux' && engine !== 'grok' && engine !== 'fish' && engine !== 'openai' && engine !== 'gemini') {
        res.statusCode = 400
        res.end(JSON.stringify({ ok: false, message: 'Unsupported STT engine' }))
        return
      }
      const key = await keyFor(req, engine)
      if (key === null) {
        res.end(JSON.stringify({ ok: false, keyConfigured: false, message: 'STT key is not configured' }))
        return
      }
      const abort = new AbortController()
      const cancel = (): void => { abort.abort() }
      res.once('close', cancel)
      try {
        const result = await probeStt({ engine, key, model: headerValue(req.headers, 'x-stt-model'), silenceSec: Number(headerValue(req.headers, 'x-stt-silence-sec') ?? '2.5') },
          abort.signal, config.stsProbeTimeoutMs ?? 15000, connectSttWebSocket)
        if (!res.destroyed) res.end(JSON.stringify({ ...result, keyConfigured: true }))
      } catch {
        if (!res.destroyed) res.end(JSON.stringify({ ok: false, keyConfigured: true, message: 'STT connection test failed' }))
      } finally {
        res.removeListener('close', cancel)
      }
    },
  }

  // Open saved-output persistence only when read-back needs it.
  const lastOutputDb = memoDb(() => LastOutputDb.open(lastOutputDbPath))

  /** The decoded path tail after `prefix` ('' when the request is the prefix
   * itself). Segment-boundary matching is the webserver's prefix contract. */
  const tailOf = (req: IncomingMessage, prefix: string): string => {
    const pathname = (req.url ?? '').split('?')[0] ?? ''
    const rest = pathname.slice(prefix.length)
    return rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : ''
  }
  const jsonReply = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status
    res.end(JSON.stringify(body))
  }

  // `lastOutputPath/<session>` — the most recent raw agent output (read-back).
  const lastOutputRoute = {
    kind: 'prefix' as const,
    path: lastOutputPath,
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      res.setHeader('Content-Type', 'application/json')
      const db = await lastOutputDb.get()
      const method = (req.method ?? 'GET').toUpperCase()
      const session = tailOf(req, lastOutputPath)
      if (session === '') {
        jsonReply(res, 400, { ok: false, error: 'missing session' })
        return
      }
      if (method === 'GET') {
        jsonReply(res, 200, { ok: true, sessionId: session, text: db.getLastOutput(session) })
        return
      }
      if (method === 'POST') {
        const body = JSON.parse((await collectBody(req)) || '{}') as { text?: string }
        db.setLastOutput(session, (body.text ?? '').trim())
        jsonReply(res, 200, { ok: true })
        return
      }
      if (method === 'DELETE') {
        db.setLastOutput(session, '')
        jsonReply(res, 200, { ok: true })
        return
      }
      jsonReply(res, 405, { ok: false, error: 'method not allowed' })
    },
  }

  ctx.effect(() => ctx.webServer.register(sttRoute), `voice-stt: ${config.path}`)
  ctx.effect(() => ctx.webServer.register(sttStreamRoute), `voice-stt: ${config.sttStreamPath}`)
  ctx.effect(() => ctx.webServer.register(ttsRoute), `voice-stt: ${config.ttsPath}`)
  ctx.effect(() => ctx.webServer.register(healthRoute), `voice-stt: ${config.healthPath}`)
  ctx.effect(() => ctx.webServer.register(lastOutputRoute), `voice-stt: ${lastOutputPath}`)
  ctx.effect(() => ctx.webServer.register(voiceLabRoute), 'voice-stt: /voice-lab')
  ctx.effect(() => {
    const unregister = ctx.webServer.registerUpgrade(sttWsRoute)
    return async () => {
      unregister()
      for (const ws of sttWsServer.clients) ws.terminate()
      sttWsServer.close()
    }
  }, `voice-stt: ${config.sttWsPath} WebSocket`)
}

/** The standalone same-origin voice lab: a plain browser page that drives the
 * raw voice pipeline (mic → STT WS → live transcript), shows phase/mic/echo
 * floor/events, and can speak a scripted reply to trigger echo + barge-in. */
const voiceLabRoute = {
  kind: 'exact' as const,
  path: '/voice-lab',
  handler: async (_req: HttpRequest, res: HttpResponse): Promise<void> => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(VOICE_LAB_HTML)
  },
}

const VOICE_LAB_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Voice Lab</title>
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6;padding:16px}
h1{font-size:16px;margin:0 0 12px}
.row{display:flex;gap:12px;align-items:center;margin:8px 0}
button{padding:6px 12px;border:1px solid #333;border-radius:6px;background:#222;color:#eee;cursor:pointer}
button.speaking{background:#3a2c00}
.badge{padding:2px 8px;border-radius:999px;background:#1a5c2a;font-size:12px}
meter{width:120px}
.phase{font-weight:600}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}
.card{background:#171a1f;border:1px solid #262a31;border-radius:8px;padding:10px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#9aa0aa;margin:0 0 6px}
#transcript{white-space:pre-wrap;min-height:60px;color:#d8e0ea}
#log{height:180px;overflow:auto;font-family:monospace;font-size:12px;color:#8fb8ff;white-space:pre-wrap}
.meterrow{display:flex;align-items:center;gap:8px;margin:3px 0}
.meterrow label{width:70px;color:#9aa0aa}
.chip{font-size:12px;color:#9aa0aa}
</style></head><body>
<h1>Voice Lab — standalone voice pipeline</h1>
<div class="row"><button id="start">Start listening</button><button id="reply">Speak reply</button>
<span class="chip">deepgram flux</span></div>
<div class="row">
 <div>Phase: <span class="phase" id="phase">idle</span> <span class="badge" id="badge"></span></div>
 <div class="chip" id="dur"></div>
</div>
<div class="meterrow"><label>mic</label><meter id="micMeter" min="0" max="1" low="0.3" high="0.7" optimum="0.5" value="0"></meter><span class="chip" id="micVal">0.000</span></div>
<div class="meterrow"><label>echo floor</label><meter id="echoMeter" min="0" max="1" low="0.3" high="0.7" value="0"></meter><span class="chip" id="echoVal">0.000</span></div>
<div class="cards">
 <div class="card"><h2>Transcript</h2><div id="transcript">(press Start, then speak)</div></div>
 <div class="card"><h2>Event log</h2><div id="log"></div></div>
</div>
<script>
const $ = (s) => document.querySelector('#' + s);
const chip = (t, c) => { t.className = c || 'chip'; };
let ws = null, ac = null, proc = null, src = null, stream = null;
let phase = 'idle', micLevel = 0, echoFloor = 0, echoCount = 0, ttsActive = false;
let vadOn = false, hangTimer = null, HANG_MS = 900, RISE = 0.02, FALL = 0.012;
let lastJitterSec = 0, jitterMs = 0;

function setPhase(p, label) { phase = p; $('phase').textContent = p; $('badge').textContent = label || ''; }
function log(s) { const l = $('log'); l.textContent += s + '\\n'; l.scrollTop = l.scrollHeight; }
function met() { $('micMeter').value = micLevel; $('micVal').textContent = micLevel.toFixed(3); $('echoMeter').value = echoFloor; $('echoVal').textContent = echoFloor.toFixed(3); }

// Speak a scripted reply through the host TTS route — plays out the speakers, so
// the micro picks it back up (echo) and a louder user voice barges in.
$('reply').onclick = async () => {
  setPhase('speaking', 'tts'); ttsActive = true; echoFloor = 0; echoCount = 0;
  try {
    const r = await fetch('/api/voice/tts', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text:'Hello there. This is a voice test. Can you hear me now?', engine:'deepgram' }) });
    if (!r.ok) { log('tts HTTP ' + r.status); return; }
    const ab = await r.arrayBuffer();
    const ctx = ac || (ac = new (window.AudioContext||window.webkitAudioContext)({ sampleRate:16000 }));
    await ctx.resume();
    const f32 = new Float32Array(new DataView(ab).buffer.slice(0)); // expects L16
    const rate = Number(r.headers.get('X-Voice-Sample-Rate'));
    const buf = ctx.createBuffer(1, f32.length, rate); buf.copyToChannel(f32,0);
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination);
    log('tts: play ' + (ab.byteLength/2/rate).toFixed(2) + 's');
    await new Promise((res)=>{ s.onended=res; s.start(); });
    log('tts: ended');
  } catch (e) { log('tts error ' + e.message); }
  ttsActive = false; setPhase('listening','ready');
};

$('start').onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount:1, echoCancellation:false, noiseSuppression:false,
      autoGainControl:false } });
    ac = new (window.AudioContext||window.webkitAudioContext)({ sampleRate:16000 });
    src = ac.createMediaStreamSource(stream);
    proc = ac.createScriptProcessor(2048,1,1);
    proc.onaudioprocess = (e) => {
      const f32 = e.inputBuffer.getChannelData(0);
      let sum=0; for(let i=0;i<f32.length;i++) sum += f32[i]*f32[i];
      micLevel = Math.sqrt(sum/f32.length);
      // echo floor: rolling baseline of mic level while we are speaking (TTS reply)
      if (ttsActive) { echoFloor = echoFloor === 0 ? micLevel : (echoFloor*0.9 + micLevel*0.1); echoCount++; }
      met();
      const pcm = new Int16Array(f32.length);
      for(let i=0;i<f32.length;i++) pcm[i] = (Math.max(-1,Math.min(1,f32[i]))*0x7fff)|0;
      if (ws && ws.readyState === 1) ws.send(new Uint8Array(pcm.buffer));
      vad(f32);
    };
    src.connect(proc); proc.connect(ac.destination);
    connectWs();
    setPhase('listening','ready');
    log('mic acquired, ws connecting...');
  } catch (e) { log('mic error ' + e.message); }
};

// Simple energy VAD over the mic block.
function vad(f32) {
  let above = micLevel > RISE;
  if (above && !vadOn) { vadOn = true; setPhase('transcribing','speech start'); log('VAD speechStart'); }
  if (!above && vadOn) {
    if (hangTimer) clearTimeout(hangTimer);
    hangTimer = setTimeout(() => { vadOn = false; log('VAD utteranceEnd'); }, HANG_MS);
  }
}

function connectWs() {
  const proto = (location.protocol === 'https:') ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/api/voice/stt/ws');
  ws.onopen = () => log('ws open');
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return;
    let f; try { f = JSON.parse(ev.data.trim()); } catch { return; }
    if (f.type === 'ready') { log('host ready'); return; }
    if (f.type === 'partial') {
      setPhase('transcribing','speech'); $('transcript').textContent = f.last || '';
    } else if (f.type === 'transcript') {
      setPhase('listening','ready'); $('transcript').textContent = f.text || f.last || '';
      log('FINAL: ' + (f.text || f.last));
    }
  };
  ws.onerror = () => log('ws error');
  ws.onclose = () => log('ws close');
}
</script></body></html>`
