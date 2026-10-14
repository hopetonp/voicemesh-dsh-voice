/** Realtime history with chat transcripts in the Session and audio bytes in verified immutable storage. */
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { Session } from '@deepseek-ai/dsh-session'
import type { StsAudioRef, StsAudioStore } from './sts-audio-store.ts'
import { stsAudioRefSchema } from './sts-audio-store.ts'
import { appendVoiceEvent } from './voice-session-events.ts'

/** One voice connection's durable history identity. */
export type StsConversationId = Branded<'voice-sts-conversation'>

/** One provider event, with raw audio replaced by a durable object reference. */
export interface StsRecordedEvent {
  readonly conversationId: StsConversationId
  readonly direction: 'connection' | 'input' | 'output'
  readonly event: Readonly<Record<string, unknown>>
  readonly audio?: { readonly field: 'audio' | 'delta'; readonly ref: StsAudioRef }
  readonly geminiAudio?: readonly { readonly part?: number; readonly ref: StsAudioRef }[]
}

const recordedSchema = z.strictObject({
  conversationId: z.string().min(1).transform(value => brandString<StsConversationId>(value)),
  direction: z.enum(['connection', 'input', 'output']),
  event: z.record(z.string(), z.unknown()),
  audio: z.strictObject({ field: z.enum(['audio', 'delta']), ref: stsAudioRefSchema }).optional(),
  geminiAudio: z.array(z.strictObject({ part: z.number().int().nonnegative().optional(), ref: stsAudioRefSchema })).optional(),
})

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Reconstructable STS provider traffic, separate from the coding model's message surface. */
    'voice/sts/event': StsRecordedEvent
    /** Final STS speech transcript retained for chat projection and replay. */
    'voice/sts/transcript': { role: 'user' | 'assistant'; text: string; conversationId: string; streamId: string; phase: 'start' | 'update' | 'final'; interrupted?: boolean }
  }
}

/** Persists chat transcripts in the Session and provider traffic in plugin storage. */
export class StsRecording {
  private pending: { append: () => void; resolve: () => void; reject: (error: unknown) => void }[] = []
  private writing = false

  private persist(append: () => void): Promise<void> {
    const operation = Promise.withResolvers<void>()
    this.pending.push({ append, resolve: operation.resolve, reject: operation.reject })
    if (!this.writing) {
      this.writing = true
      queueMicrotask(() => { void this.drain() })
    }
    return operation.promise
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      const batch = this.pending.splice(0)
      try {
        // Session flush drains to quiescence; new voice arrivals must stay outside that barrier.
        for (const item of batch) item.append()
        if (!await this.flush()) throw new Error('STS requires a durable Session persistence provider')
        for (const item of batch) item.resolve()
      } catch (error) {
        for (const item of [...batch, ...this.pending.splice(0)]) item.reject(error)
      }
    }
    this.writing = false
  }

  /**
   * @param conversationId - identity retained across records for this voice conversation.
   * @param session - the authenticated, linked Session owning the voice history.
   * @param audio - development audio storage; undefined disables raw provider recording.
   * @param rates - negotiated PCM clocks for flat audio events.
   * @param flush - SessionStore.flush for the linked Session; false means no durability provider.
   */
  constructor(
    private readonly conversationId: StsConversationId,
    private readonly session: Session,
    private readonly audio: StsAudioStore | undefined,
    private readonly flush: () => Promise<boolean>,
    private readonly rates: { inputSampleRate: 16000 | 24000; outputSampleRate: 16000 | 24000 }
      = { inputSampleRate: 16000, outputSampleRate: 16000 },
  ) {}

  /**
   * Save development audio and provider events before delivery. Without audio recording,
   * retain task receipts, Live appends and withheld sends, restored context, usage, and finalization.
   * @param direction - provider connection metadata, input, or output.
   * @param event - exact provider event, excluding the configured API credential.
   * @param signal - owning voice lifetime; cancellation withholds subsequent delivery.
   * @returns completion after any retained records are durable.
   */
  async record(direction: StsRecordedEvent['direction'], event: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const audio = this.audio
    if (audio === undefined) {
      if (direction === 'connection' && typeof event.type === 'string' && (event.type.startsWith('coding-task.') || event.type === 'session.context-restored' || event.type === 'session.finalized' || event.type === 'input.withheld')) {
        await this.persist(() => { appendVoiceEvent(this.session, 'voice/sts/event', { conversationId: this.conversationId, direction, event }) })
        signal.throwIfAborted()
      }
      if (direction === 'input' && (event.type === 'session.thinking.append'
        || event.type === 'session.commentary.append' || event.type === 'session.instructions.append')) {
        await this.persist(() => { appendVoiceEvent(this.session, 'voice/sts/event', { conversationId: this.conversationId, direction, event }) })
        signal.throwIfAborted()
      }
      if (direction === 'output' && (event.type === 'session.usage.updated' || event.type === 'session.closed')) {
        await this.persist(() => { appendVoiceEvent(this.session, 'voice/sts/event', { conversationId: this.conversationId, direction, event }) })
        signal.throwIfAborted()
      }
      return
    }
    const field = event.type === 'input_audio_buffer.append' || event.type === 'session.input_audio.append' ? 'audio'
      : event.type === 'response.output_audio.delta' || event.type === 'session.output_audio.delta' || event.type === 'session.input_audio.delta' ? 'delta' : undefined
    let data: StsRecordedEvent
    if ('realtimeInput' in event || 'serverContent' in event) {
      const metadata: Record<string, unknown> = structuredClone(event)
      const chunks: { part?: number; ref: StsAudioRef }[] = []
      const save = (container: Record<string, unknown>, rate: 16000 | 24000, part?: number): void => {
        if (container.mimeType !== `audio/pcm;rate=${rate}`) throw new Error('STS audio MIME type does not match its clock rate')
        const encoded = z.string().parse(container.data)
        const pcm = Buffer.from(encoded, 'base64')
        if (pcm.toString('base64') !== encoded) throw new Error('STS audio event is not canonical base64')
        chunks.push({ ...(part === undefined ? {} : { part }), ref: audio.save(pcm, rate) })
        delete container.data
      }
      const input = z.object({ audio: z.record(z.string(), z.unknown()).optional() }).optional().parse(metadata.realtimeInput)
      if (input?.audio !== undefined) {
        save(input.audio, 16000)
        metadata.realtimeInput = { ...z.record(z.string(), z.unknown()).parse(metadata.realtimeInput), audio: input.audio }
      }
      const output = z.object({
        modelTurn: z.object({ parts: z.array(z.record(z.string(), z.unknown())) }).passthrough().optional(),
      }).passthrough().optional().parse(metadata.serverContent)
      output?.modelTurn?.parts.forEach((part, index) => {
        if (part.inlineData === undefined) return
        const inline = z.record(z.string(), z.unknown()).parse(part.inlineData)
        save(inline, 24000, index)
        part.inlineData = inline
      })
      if (output !== undefined) metadata.serverContent = output
      data = { conversationId: this.conversationId, direction, event: metadata, ...(chunks.length === 0 ? {} : { geminiAudio: chunks }) }
    } else if (field === undefined) {
      data = { conversationId: this.conversationId, direction, event }
    } else {
      const encoded = event[field]
      if (typeof encoded !== 'string') throw new Error('STS audio event is missing encoded PCM')
      const pcm = Buffer.from(encoded, 'base64')
      if (pcm.toString('base64') !== encoded) throw new Error('STS audio event is not canonical base64')
      const ref = audio.save(pcm, field === 'audio' ? this.rates.inputSampleRate : this.rates.outputSampleRate)
      const metadata = { ...event }
      if (field === 'audio') delete metadata.audio
      else delete metadata.delta
      data = { conversationId: this.conversationId, direction, event: metadata, audio: { field, ref } }
    }
    await this.persist(() => { appendVoiceEvent(this.session, 'voice/sts/event', data) })
    signal.throwIfAborted()
  }

  /** Persist one completed speech transcript without exposing it to the coding model. */
  async recordTranscript(role: 'user' | 'assistant', text: string, signal: AbortSignal, streamId = 'final', phase: 'start' | 'update' | 'final' = 'final', interrupted = false): Promise<void> {
    signal.throwIfAborted()
    const value = text.trim()
    if (value === '') return
    await this.persist(() => {
      this.session.append('voice/sts/transcript', { conversationId: this.conversationId, role, text: value, streamId, phase, ...(interrupted ? { interrupted: true } : {}) })
    })
    signal.throwIfAborted()
  }

  private readAudio(ref: StsAudioRef): Uint8Array {
    if (this.audio === undefined) throw new Error('Raw STS replay requires development recording storage')
    return this.audio.read(ref)
  }

  /**
   * Validate a durable record and restore its original provider JSON.
   * @param input - logged provider metadata and optional audio reference.
   * @returns the original event, verifying stored audio before reconstruction.
   */
  restore(input: unknown): Readonly<Record<string, unknown>> {
    const record = recordedSchema.parse(input)
    if (record.conversationId !== this.conversationId) throw new Error('STS record belongs to another conversation')
    if (record.geminiAudio !== undefined) {
      if (record.audio !== undefined) throw new Error('STS record mixes provider audio formats')
      const event = structuredClone(record.event)
      for (const chunk of record.geminiAudio) {
        let container: Record<string, unknown>
        if (chunk.part === undefined) {
          if (record.direction !== 'input' || chunk.ref.sampleRate !== 16000) throw new Error('Invalid Gemini input audio reference')
          container = z.record(z.string(), z.unknown()).parse(z.object({ audio: z.unknown() }).parse(event.realtimeInput).audio)
          event.realtimeInput = { ...z.record(z.string(), z.unknown()).parse(event.realtimeInput), audio: container }
        } else {
          if (record.direction !== 'output' || chunk.ref.sampleRate !== 24000) throw new Error('Invalid Gemini output audio reference')
          const content = z.object({
            modelTurn: z.object({ parts: z.array(z.record(z.string(), z.unknown())) }).passthrough(),
          }).passthrough().parse(event.serverContent)
          const part = content.modelTurn.parts[chunk.part]
          if (part === undefined) throw new Error('Gemini audio part is missing')
          container = z.record(z.string(), z.unknown()).parse(part.inlineData)
          part.inlineData = container
          event.serverContent = content
        }
        if ('data' in container) throw new Error('Gemini audio record contains duplicate data')
        container.data = Buffer.from(this.readAudio(chunk.ref)).toString('base64')
      }
      return event
    }
    if (record.audio === undefined) {
      if (record.event.type === 'input_audio_buffer.append' || record.event.type === 'response.output_audio.delta') throw new Error('STS audio record is missing its storage reference')
      const incoming = z.object({ audio: z.unknown().optional() }).optional().parse(record.event.realtimeInput)
      const outgoing = z.object({
        modelTurn: z.object({ parts: z.array(z.object({ inlineData: z.unknown().optional() })) }).optional(),
      }).optional().parse(record.event.serverContent)
      if (incoming?.audio !== undefined || outgoing?.modelTurn?.parts.some(part => part.inlineData !== undefined)) throw new Error('Gemini audio record is missing its storage reference')
      return record.event
    }
    const expected = record.direction === 'input' && (record.event.type === 'input_audio_buffer.append' || record.event.type === 'session.input_audio.append') ? 'audio'
      : record.direction === 'output' && (record.event.type === 'response.output_audio.delta' || record.event.type === 'session.output_audio.delta' || record.event.type === 'session.input_audio.delta') ? 'delta' : undefined
    if (record.audio.field !== expected || expected in record.event) throw new Error('STS audio record has inconsistent metadata')
    return { ...record.event, [record.audio.field]: Buffer.from(this.readAudio(record.audio.ref)).toString('base64') }
  }
}
