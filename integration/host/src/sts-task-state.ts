/** Request-specific coding progress reconstructed from the linked Session log. */
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from './sts-recording.ts'

/** Voice task progress; uncertain admission is never automatically retried. */
export interface StsTaskState {
  readonly requestId: SessionRequestId
  readonly status: 'uncertain' | 'queued' | 'running' | 'completed' | 'stopped' | 'failed'
  readonly turn?: number
  readonly shared: boolean
  readonly text: string
  /** Durable correction/cancellation generation, independent of task status. */
  readonly revision: number
  /** Revision consumed by the producer of text; null without a written result. */
  readonly resultRevision: number | null
}

/**
 * Correlate one request with inbox claims and its owning turn, including pre-step stops.
 * @param events - the linked Session's own ordered events.
 * @param requestId - persisted source RPC identity of the voice task.
 * @returns task progress without crediting unrelated turns or messages.
 */
export function stsTaskState(events: readonly SessionEvent[], requestId: SessionRequestId): StsTaskState {
  const queues: Record<'next-step' | 'next-turn', UserMessage[]> = { 'next-step': [], 'next-turn': [] }
  const members = new Map<number, Set<string>>()
  const stepped = new Set<number>()
  let open: number | undefined
  let turn: number | undefined
  let status: StsTaskState['status'] = 'uncertain'
  const isRunning = (): boolean => status === 'running'
  let text = ''
  let revision = 0
  let consumedRevision = 0
  let resultRevision: number | null = null
  const corrections = new Map<string, number>()
  const messageRevisions = new Map<string, number>()
  const groups = new Map<string, string>()
  for (const event of events) {
    if (event.type !== 'voice/sts/event' || event.data.event.type !== 'coding-task.steer-requested') continue
    const value = event.data.event
    if (typeof value.requestId !== 'string' || typeof value.parentRequestId !== 'string') throw new Error('Invalid durable voice steering record')
    groups.set(value.requestId, value.parentRequestId)
  }
  const rpc = (message: UserMessage): string => message.source.kind === 'user' && 'rpcId' in message.source
    ? groups.get(message.source.rpcId) ?? message.source.rpcId : `message:${message.id}`
  const claim = (message: UserMessage, owningTurn: number): void => {
    if (message.source.kind !== 'user') return
    const identities = members.get(owningTurn) ?? new Set<string>()
    identities.add(rpc(message))
    members.set(owningTurn, identities)
    if (rpc(message) === requestId) {
      turn = owningTurn
      status = 'running'
    }
  }
  for (const event of events) {
    switch (event.type) {
      case 'turn/start': open = event.data.turn; break
      case 'step/start': stepped.add(event.data.turn); break
      case 'voice/sts/event':
        if (event.data.event.type === 'coding-task.steer-requested' && event.data.event.parentRequestId === requestId) {
          revision += 1
          corrections.set(String(event.data.event.requestId), revision)
        }
        if (event.data.event.type === 'coding-task.stop-requested' && event.data.event.requestId === requestId) revision += 1
        if (event.data.event.type === 'coding-task.not-admitted' && event.data.event.requestId === requestId) status = 'failed'
        break
      case 'agent/inbox/spliced': {
        const splice = event.data
        const removed = queues[splice.target].splice(splice.start, splice.removedCount ?? 0, ...splice.inserted)
        for (const message of removed) {
          if (splice.outcome === 'canceled') {
            // Removing pending input does not stop its already-running owning turn.
            if (rpc(message) === requestId && !isRunning()) status = 'stopped'
          } else if (open !== undefined) claim(message, open)
        }
        for (const message of splice.inserted) if (rpc(message) === requestId) {
          messageRevisions.set(message.id, revision)
          if (!isRunning()) status = 'queued'
        }
        break
      }
      case 'user/message':
        if (open !== undefined) {
          claim(event.data, open)
          if (rpc(event.data) === requestId && 'rpcId' in event.data.source) {
            consumedRevision = corrections.get(event.data.source.rpcId) ?? messageRevisions.get(event.data.id) ?? 0
          }
        }
        break
      case 'assistant/message':
        if (event.data.turn === turn) {
          text = event.data.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
          resultRevision = consumedRevision
        }
        break
      case 'turn/end':
        if (event.data.turn === turn) {
          const reason = event.data.reason.kind
          status = reason === 'completed' ? stepped.has(event.data.turn) ? 'completed' : 'stopped'
            : reason === 'aborted' || reason === 'interrupted' ? 'stopped' : 'failed'
        }
        open = undefined
        break
      default: break // Other merge-extensible Session events do not change task ownership.
    }
  }
  if (!isRunning() && [...queues['next-step'], ...queues['next-turn']].some(message => rpc(message) === requestId)) status = 'queued'
  return {
    requestId, status, ...(turn === undefined ? {} : { turn }),
    shared: turn !== undefined && (members.get(turn)?.size ?? 0) > 1, text, revision, resultRevision,
  }
}
