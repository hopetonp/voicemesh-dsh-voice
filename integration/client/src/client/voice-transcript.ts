import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

/**
 * Payload of the durable transcript row the host half writes.
 *
 * The event type has exactly one declaration site — `voice/sts/transcript` in the host half, which is
 * what appends it and what the persistence catalog reads — so this package never augments
 * `SessionEventMap` for it and never depends on the host half. The row is recognized here by its own
 * shape instead, which also keeps a payload drift from becoming a render-time crash.
 */
interface VoiceTranscriptRow {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly conversationId: string
  readonly streamId: string
  readonly phase: 'start' | 'update' | 'final'
  readonly interrupted?: boolean
}

/** The row type stays a `string` so it can be compared against the typed event union. */
const TRANSCRIPT_ROW: string = 'voice/sts/transcript'

/**
 * Read the transcript payload from one session event.
 * @param event - event offered by the conversation engine.
 * @returns the validated payload, or `undefined` when this is not a transcript row.
 */
function transcriptRow(event: SessionEventLike): VoiceTranscriptRow | undefined {
  if (event.type !== TRANSCRIPT_ROW) return undefined
  const data: unknown = event.data
  if (typeof data !== 'object' || data === null) return undefined
  const row = data as Record<string, unknown>
  const { role, text, conversationId, streamId, phase } = row
  if (role !== 'user' && role !== 'assistant') return undefined
  if (typeof text !== 'string' || typeof conversationId !== 'string' || typeof streamId !== 'string') return undefined
  if (phase !== 'start' && phase !== 'update' && phase !== 'final') return undefined
  return { role, text, conversationId, streamId, phase, ...(row.interrupted === true ? { interrupted: true } : {}) }
}

interface VoiceTranscriptNode {
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly seq: number
  readonly time: number
  readonly phase: 'start' | 'update' | 'final'
  readonly interrupted?: boolean
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Finalized STS speech transcript kept outside coding-model messages. */
    'voice-transcript': VoiceTranscriptNode
  }
}

/** Durable STS transcript contribution to the Chat target. */
export const voiceTranscriptDefinition: ConversationNodeDefinition<VoiceTranscriptNode> = {
  kind: 'voice-sts-transcript',
  target: 'chat',
  match: (event) => {
    const row = transcriptRow(event)
    return row === undefined ? null : { id: `${row.conversationId}:${row.streamId}`, role: 'update' }
  },
  start: (_context, match) => {
    const row = transcriptRow(match.event)
    if (row === undefined) throw new Error('voice transcript requires voice/sts/transcript')
    return {
      role: row.role, text: row.text, seq: match.event.seq, time: match.event.time, phase: row.phase,
      ...(row.interrupted === true ? { interrupted: true } : {}),
    }
  },
  update: (_context, match) => {
    const row = transcriptRow(match.event)
    if (row === undefined) throw new Error('voice transcript update requires voice/sts/transcript')
    return {
      role: row.role, text: row.text, seq: match.event.seq, time: match.event.time, phase: row.phase,
      ...(row.interrupted === true ? { interrupted: true } : {}),
    }
  },
  buildViewNode: (context) => {
    const event = context.matches.at(-1)?.event
    const row = event === undefined ? undefined : transcriptRow(event)
    if (event === undefined || row === undefined) return null
    const first = context.matches[0]?.event ?? event
    return {
      key: context.key, id: context.id, target: 'chat', kind: 'voice-transcript',
      anchorSeq: first.seq, location: { kind: 'session' }, visibility: 'visible',
      data: { ...row, seq: first.seq, time: first.time },
    }
  },
}
