/** Optional local STT/TTS adapters. Native inference runs in a disposable worker, never on the web server thread. */
import { Worker } from 'node:worker_threads'
import { readdir, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { z } from 'zod'
import type { SpeechRecognizer, TurnStreamingRecognizer, RecognizedTurn, SpeechSynthesizer } from '@voicemesh/composer'

const voiceSchema = z.object({ id: z.string(), name: z.string(), languages: z.array(z.string()), gender: z.string().default(''), region: z.string().default('') })
const manifestSchema = z.object({
  kind: z.enum(['stt', 'tts']), name: z.string(), languages: z.array(z.string()), sourceUrl: z.url(),
  voices: z.array(voiceSchema).default([]),
  kokoro: z.record(z.string(), z.string()).optional(),
})
type LocalModel = z.infer<typeof manifestSchema> & { id: string; path: string }
/** Host configuration for explicitly installed native runtime and model packs. */
export interface LocalVoiceConfig {
  runtimePath: string
  modelsPath: string
  threads: number
  idleMs: number
  timeoutMs: number
}
const replySchema = z.object({
  type: z.enum(['ready', 'result', 'audio', 'chunk', 'error']), id: z.number().optional(), text: z.string().optional(),
  error: z.string().optional(),
  sampleRate: z.number().optional(), speakers: z.number().optional(), samples: z.instanceof(Float32Array).optional(),
})
type Reply = z.infer<typeof replySchema>

class NativeWorker {
  readonly worker: Worker
  private nextId = 0
  private pending = new Map<number, {
    resolve: (reply: Reply) => void
    reject: (error: Error) => void
    onChunk: ((reply: Reply) => void) | undefined
  }>()
  private dead = false
  private closing = false
  private readonly shutdownMs: number
  readonly ready: Promise<Reply>
  readonly closed: Promise<void>
  constructor(config: LocalVoiceConfig, model: LocalModel) {
    this.shutdownMs = config.timeoutMs
    this.worker = new Worker(join(config.runtimePath, 'worker.mjs'), { execArgv: [], workerData: { kind: model.kind, model, threads: config.threads } })
    this.closed = new Promise(resolveClosed => this.worker.once('exit', () =>{  resolveClosed() }))
    this.ready = new Promise<Reply>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => { void this.close(); rejectReady(new Error('Local model loading timed out')) }, config.timeoutMs)
      this.worker.on('message', (raw: unknown) => {
        const parsed = replySchema.safeParse(raw)
        if (!parsed.success) { void this.close(); rejectReady(new Error('Invalid local worker response')); return }
        const reply = parsed.data
        if (reply.type === 'ready') { clearTimeout(timer); resolveReady(reply); return }
        if (reply.id === undefined) { clearTimeout(timer); rejectReady(new Error(reply.error ?? 'Local worker failed')); return }
        const pending = this.pending.get(reply.id)
        if (reply.type === 'chunk') {
          try { pending?.onChunk?.(reply) }
          catch (error) { pending?.reject(error instanceof Error ? error : new Error(String(error))); void this.close() }
          return
        }
        this.pending.delete(reply.id)
        if (reply.type === 'error') pending?.reject(new Error(reply.error))
        else pending?.resolve(reply)
      })
      this.worker.on('error', (error) => { clearTimeout(timer); rejectReady(error); this.fail(error) })
      this.worker.on('exit', () => { clearTimeout(timer); const error = new Error('Local voice worker stopped'); rejectReady(error); this.fail(error) })
    })
    void this.ready.catch(() => {})
  }
  private fail(error: Error): void {
    this.dead = true
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }
  async call(input: Record<string, unknown>, signal?: AbortSignal, onChunk?: (reply: Reply) => void): Promise<Reply> {
    await this.ready
    signal?.throwIfAborted()
    if (this.dead) throw new Error('Local voice worker stopped')
    const id = ++this.nextId
    const abort = (): void => { void this.close() }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      return await new Promise<Reply>((resolveReply, reject) => {
        this.pending.set(id, { resolve: resolveReply, reject, onChunk })
        this.worker.postMessage({ ...input, id })
      })
    } finally { signal?.removeEventListener('abort', abort) }
  }
  close(): Promise<void> {
    if (this.closing) return this.closed
    this.closing = true
    this.fail(new Error('Local voice cancelled'))
    this.worker.postMessage({ type: 'dispose' })
    const timer = setTimeout(() => { void this.worker.terminate() }, this.shutdownMs)
    timer.unref()
    this.worker.once('exit', () =>{  clearTimeout(timer) })
    return this.closed
  }
}

/** Local model discovery and worker ownership; cloud use does not load native libraries. */
export class LocalVoice {
  private workers = new Set<NativeWorker>()
  private disposed = false
  private shutdown = new Set<Promise<void>>()
  private idle = new Map<string, { worker: NativeWorker; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly config: LocalVoiceConfig) {}
  /** Read installed model manifests.
   * @returns installed models with host-owned paths.
   */
  async models(): Promise<LocalModel[]> {
    if (!this.config.runtimePath || !this.config.modelsPath) return []
    const entries = await readdir(this.config.modelsPath, { withFileTypes: true })
    const models: LocalModel[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(this.config.modelsPath, entry.name)
      let raw: string
      try { raw = await readFile(join(path, 'voice-model.json'), 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      const manifest = manifestSchema.parse(JSON.parse(raw))
      const kokoro = manifest.kokoro === undefined ? undefined : Object.fromEntries(Object.entries(manifest.kokoro)
        .map(([key, value]) => [key, value.split(',').map(asset => resolve(path, asset)).join(',')]))
      models.push({ ...manifest, ...(kokoro ? { kokoro } : {}), id: entry.name, path })
    }
    return models
  }
  private assertActive(): void {
    if (this.disposed) throw new Error('Local voice is disposed')
  }
  private async acquire(id: string, kind: 'stt' | 'tts'): Promise<NativeWorker> {
    this.assertActive()
    const model = (await this.models()).find(item => item.id === id && item.kind === kind)
    this.assertActive()
    if (!model) throw new Error('Select an installed local voice model')
    const cached = this.idle.get(id)
    if (cached) { clearTimeout(cached.timer); this.idle.delete(id); return cached.worker }
    const worker = new NativeWorker(this.config, model)
    this.workers.add(worker)
    try { await worker.ready; this.assertActive(); return worker }
    catch (error) { this.discard(worker); throw error }
  }
  private discard(worker: NativeWorker): void {
    const done = worker.close()
    this.shutdown.add(done)
    void done.finally(() => this.shutdown.delete(done))
    this.workers.delete(worker)
  }
  private release(id: string, worker: NativeWorker): void {
    if (this.idle.has(id) || !this.workers.has(worker)) { this.discard(worker); return }
    const timer = setTimeout(() => { this.idle.delete(id); this.discard(worker) }, this.config.idleMs)
    timer.unref()
    this.idle.set(id, { worker, timer })
  }
  /** Build a native streaming recognizer.
   * @param id - Installed model ID.
   * @returns recognizer using cumulative transcripts.
   */
  recognizer(id: string): SpeechRecognizer & TurnStreamingRecognizer {
    // Async generators have no arrow syntax to capture the provider.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const owner = this
    let active: NativeWorker | undefined
    return {
      inputSampleRate: 16000, id: 'vosk', label: 'Vosk (local)',
      async availabilityProblem() { return (await owner.models()).some(model => model.id === id && model.kind === 'stt') ? null : 'Select an installed Vosk model' },
      async transcribe(bytes) {
        let text = ''
        const audio = { async *[Symbol.asyncIterator]() { yield await Promise.resolve(bytes) } }
        for await (const turn of this.turnStream(audio)) text = turn.transcript
        return text
      },
      async checkEndpoint(bytes) { return { text: await this.transcribe(bytes), isEndpoint: true } },
      async *turnStream(chunks, signal): AsyncIterable<RecognizedTurn> {
        const worker = await owner.acquire(id, 'stt')
        active = worker
        let complete = false
        let previous = ''
        try {
          for await (const audio of chunks) {
            const reply = await worker.call({ type: 'audio', audio }, signal)
            const text = reply.text ?? ''
            if (text !== previous) { yield { stage: previous === '' ? 'start' : 'update', transcript: text }; previous = text }
          }
          const reply = await worker.call({ type: 'final' }, signal)
          yield { stage: 'end', transcript: reply.text ?? '' }
          complete = true
        } finally {
          active = undefined
          if (complete) owner.release(id, worker)
          else owner.discard(worker)
        }
      },
      dispose() { if (active) owner.discard(active); active = undefined },
    }
  }
  /** Build a local speech synthesizer.
   * @param voice - Installed model ID and numeric speaker ID.
   * @param sink - Receives PCM16 mono audio chunks at outputSampleRate.
   * @returns cancellable PCM16 synthesis at the installed model rate.
   */
  synthesizer(voice: string, sink: (bytes: Uint8Array) => void): SpeechSynthesizer {
    const split = voice.lastIndexOf(':')
    const id = voice.slice(0, split)
    const speaker = Number(voice.slice(split + 1))
    let active: NativeWorker | undefined
    let stopped = false
    const isStopped = (): boolean => stopped
    let sampleRate = 0
    return {
      get outputSampleRate() {
        if (sampleRate === 0) throw new Error('Local speech format is not ready')
        return sampleRate
      },
      id: 'kokoro', label: 'Kokoro (local)',
      availabilityProblem: async () => (await this.models()).some(model => model.id === id && model.kind === 'tts') ? null : 'Select an installed Kokoro voice',
      speak: async (text, output = sink) => {
        if (split < 0 || !Number.isInteger(speaker) || speaker < 0) throw new Error('Invalid local voice selection')
        stopped = false
        const worker = await this.acquire(id, 'tts')
        if (isStopped()) { this.discard(worker); return }
        active = worker
        let complete = false
        try {
          const ready = await worker.ready
          if (typeof ready.sampleRate !== 'number' || !Number.isInteger(ready.sampleRate) || ready.sampleRate < 8000 || ready.sampleRate > 192000) throw new Error('Invalid local speech sample rate')
          sampleRate = ready.sampleRate
          if (speaker >= (ready.speakers ?? 0)) throw new Error('Unknown local voice')
          await worker.call({ type: 'speak', text, speaker }, AbortSignal.timeout(this.config.timeoutMs), (reply) => {
            if (isStopped()) return
            if (!reply.samples || reply.sampleRate !== sampleRate) throw new Error('Invalid local speech audio')
            if (reply.samples.length) output(localPcm16(reply.samples))
          })
          complete = true
        } catch (error) { if (!isStopped()) throw error }
        finally { active = undefined; if (complete && !isStopped()) this.release(id, worker); else this.discard(worker) }
      },
      stop: () => { stopped = true; if (active) this.discard(active) },
      dispose: () => { stopped = true; if (active) this.discard(active) },
    }
  }
  /** Release all native workers, including idle model caches. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const idle of this.idle.values()) clearTimeout(idle.timer)
    this.idle.clear()
    for (const worker of this.workers) this.discard(worker)
    await Promise.all(this.shutdown)
  }
}

/** Encode filtered mono 16kHz samples as PCM16.
 * @param samples - Resampled native audio.
 * @returns little-endian PCM16 bytes.
 */
export function localPcm16(samples: Float32Array): Uint8Array {
  const output = new Uint8Array(samples.length * 2)
  const view = new DataView(output.buffer)
  samples.forEach((sample, i) => {
    view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true)
  })
  return output
}
