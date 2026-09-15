import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Final STS speech transcript retained for Chat projection. */
    'voice/sts/transcript': { role: 'user' | 'assistant'; text: string; conversationId: string; streamId: string; phase: 'start' | 'update' | 'final'; interrupted?: boolean }
  }
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
  match: event => event.type === 'voice/sts/transcript'
    ? { id: `${event.data.conversationId}:${event.data.streamId}`, role: 'update' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'voice/sts/transcript') throw new Error('voice transcript requires voice/sts/transcript')
    const data = match.event.data
    return {
      role: data.role, text: data.text, seq: match.event.seq, time: match.event.time, phase: data.phase,
      ...(data.interrupted ? { interrupted: true } : {}),
    }
  },
  update: (_context, match) => {
    if (match.event.type !== 'voice/sts/transcript') throw new Error('voice transcript update requires voice/sts/transcript')
    const data = match.event.data
    return {
      role: data.role, text: data.text, seq: match.event.seq, time: match.event.time, phase: data.phase,
      ...(data.interrupted ? { interrupted: true } : {}),
    }
  },
  buildViewNode: (context) => {
    const event = context.matches.at(-1)?.event
    if (event?.type !== 'voice/sts/transcript') return null
    const first = context.matches[0]?.event ?? event
    return {
      key: context.key, id: context.id, target: 'chat', kind: 'voice-transcript',
      anchorSeq: first.seq, location: { kind: 'session' }, visibility: 'visible',
      data: { ...event.data, seq: first.seq, time: first.time },
    }
  },
}
