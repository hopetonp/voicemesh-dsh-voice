/** Durable, session-bound admission of voice-originated coding work. */
import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { stsTaskState, type StsTaskState } from './sts-task-state.ts'
import type { StsConversationId, StsRecording } from './sts-recording.ts'
import { voiceSessionEvents } from './voice-session-events.ts'

const instructionSchema = z.strictObject({ instruction: z.string().trim().min(1).max(32000) })
const intentSchema = z.strictObject({
  type: z.literal('coding-task.intent'),
  requestId: z.string().min(1).transform(value => brandString<SessionRequestId>(value)),
  instruction: z.string().min(1),
})

export { voiceTaskTools as stsTaskTools } from '@dsh-voice/harness-policy'

/** A task controller belongs to the host's exclusive live STS owner for one Session. */
export class StsTasks {
  private tail = Promise.resolve()

  /**
   * @param session - authenticated linked coding Session.
   * @param conversationId - host-generated voice conversation identity.
   * @param recording - recorder for durable admission decisions.
   * @param controller - ordinary coding prompt admission service.
   */
  constructor(
    private readonly session: Session,
    private readonly conversationId: StsConversationId,
    private readonly recording: StsRecording,
    private readonly controller: Pick<SessionController, 'prompt' | 'resolveAgent' | 'updateQueue' | 'cancel'>,
  ) {}

  /**
   * Validate, durably deduplicate, and admit a provider function call.
   * @param callId - provider call identity scoped to this voice conversation.
   * @param input - parsed function arguments from the provider wire.
   * @param signal - conversation lifetime; checked before admission begins.
   * @returns current task state after admission, never its eventual completion.
   */
  dispatch(callId: string, input: unknown, signal: AbortSignal): Promise<StsTaskState> {
    const operation = this.tail.then(async () => {
      signal.throwIfAborted()
      const { instruction } = instructionSchema.parse(input)
      const requestId = brandString<SessionRequestId>(`voice:${createHash('sha256').update(JSON.stringify([this.conversationId, callId])).digest('hex')}`)
      const intents = this.intents()
      const duplicate = intents.find(intent => intent.requestId === requestId)
      if (duplicate !== undefined) {
        if (duplicate.instruction !== instruction) throw new Error('STS coding call identity was reused with different arguments')
        return stsTaskState(voiceSessionEvents(this.session), requestId)
      }
      for (const intent of intents) {
        const state = stsTaskState(voiceSessionEvents(this.session), intent.requestId)
        if (state.status === 'uncertain' || state.status === 'queued' || state.status === 'running') {
          throw new Error('The linked session already has outstanding voice coding work')
        }
      }
      await this.recording.record('connection', { type: 'coding-task.intent', requestId, instruction }, signal)
      try {
        await this.controller.prompt({ sessionId: this.session.id, requestId, mode: 'queue', content: [{ type: 'text', text: instruction }] }, signal)
      } catch (error) {
        if (stsTaskState(voiceSessionEvents(this.session), requestId).status === 'uncertain') {
          // The settled local admission has no inbox insertion. Persist this outcome even after voice cancellation.
          await this.recording.record('connection', { type: 'coding-task.not-admitted', requestId }, new AbortController().signal)
        }
        throw error
      }
      await this.recording.record('connection', { type: 'coding-task.accepted', requestId }, signal)
      return stsTaskState(voiceSessionEvents(this.session), requestId)
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  /**
   * Read only voice-owned requests from the linked Session.
   * @returns progress for each durable dispatch intent, including uncertain admissions.
   */
  states(): readonly StsTaskState[] {
    const events = voiceSessionEvents(this.session)
    return this.intents().map(intent => stsTaskState(events, intent.requestId))
  }

  /**
   * Cancel only the pending or exclusively owned running voice task.
   * @param callId - provider function-call identity, scoped to this conversation.
   * @param input - empty function arguments; arbitrary Session/task selectors are refused.
   * @param signal - voice lifetime before the cancellation decision.
   * @returns recorded task states after the stop request; running cancellation may still be settling.
   */
  stop(callId: string, input: unknown, signal: AbortSignal): Promise<readonly StsTaskState[]> {
    const operation = this.tail.then(async () => {
      z.strictObject({}).parse(input)
      signal.throwIfAborted()
      const decisionId = `${this.conversationId}:${callId}`
      if (voiceSessionEvents(this.session).some(event => event.type === 'voice/sts/event'
        && event.data.event.type === 'coding-task.stop-requested' && event.data.event.decisionId === decisionId)) return this.states()
      const found = await this.controller.resolveAgent(this.session.id)
      signal.throwIfAborted()
      if ('error' in found) throw new Error('Linked coding session is unavailable')
      const task = this.states().find(state => state.status === 'queued' || state.status === 'running')
      if (task === undefined) return this.states()
      if (task.shared) throw new Error('The coding turn includes other work; stop it from the coding session')
      await this.recording.record('connection', { type: 'coding-task.stop-requested', decisionId, requestId: task.requestId }, signal)
      // Recording may overlap loop progress. Recheck ownership immediately before synchronous cancellation.
      const current = stsTaskState(voiceSessionEvents(this.session), task.requestId)
      if (current.shared) throw new Error('The coding turn includes other work; stop it from the coding session')
      for (const message of [...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep]) {
        if (message.source.kind === 'user' && 'rpcId' in message.source && this.owns(task.requestId, message.source.rpcId)) {
          this.controller.updateQueue({ sessionId: this.session.id, itemId: message.id, action: { kind: 'remove' } })
        }
      }
      if (current.status === 'running') this.controller.cancel({ sessionId: this.session.id })
      await this.recording.record('connection', { type: 'coding-task.stop-applied', decisionId, requestId: task.requestId }, new AbortController().signal)
      return this.states()
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  /**
   * Add an explicit correction to the one outstanding voice coding task.
   * @param callId - provider identity used to deduplicate steering admission.
   * @param input - instruction-only function arguments.
   * @param signal - conversation lifetime before admission.
   * @returns task progress after the correction is queued.
   */
  steer(callId: string, input: unknown, signal: AbortSignal): Promise<readonly StsTaskState[]> {
    const operation = this.tail.then(async () => {
      const { instruction } = instructionSchema.parse(input)
      signal.throwIfAborted()
      const requestId = brandString<SessionRequestId>(`voice:${createHash('sha256').update(JSON.stringify([this.conversationId, callId])).digest('hex')}`)
      if (voiceSessionEvents(this.session).some(event => event.type === 'voice/sts/event'
        && event.data.event.type === 'coding-task.steer-requested' && event.data.event.requestId === requestId)) return this.states()
      const found = await this.controller.resolveAgent(this.session.id)
      signal.throwIfAborted()
      if ('error' in found) throw new Error('Linked coding session is unavailable')
      const task = this.states().find(state => state.status === 'queued' || state.status === 'running')
      if (task === undefined || task.shared) throw new Error('No exclusively owned voice coding task is available for steering')
      await this.recording.record('connection', { type: 'coding-task.steer-requested', requestId, parentRequestId: task.requestId, instruction }, signal)
      const current = stsTaskState(voiceSessionEvents(this.session), task.requestId)
      if (current.shared) throw new Error('The coding turn now includes other work')
      if (current.status === 'queued') {
        const pending = [...found.agent.inbox.nextTurn, ...found.agent.inbox.nextStep].find(message =>
          message.source.kind === 'user' && 'rpcId' in message.source && this.owns(task.requestId, message.source.rpcId))
        if (pending === undefined) throw new Error('Queued voice task is no longer available')
        const queuedText = pending.content.map(part => part.type === 'text' ? part.text : '').join('')
        this.controller.updateQueue({ sessionId: this.session.id, itemId: pending.id, action: { kind: 'edit', content: [
          { type: 'text', text: queuedText + instruction },
        ] } })
      } else if (current.status === 'running') {
        // Text-only steering must share the ownership check's synchronous admission point.
        found.agent.steer(createUserMessage({ content: [{ type: 'text', text: instruction }], source: { kind: 'user', rpcId: requestId } }))
      } else throw new Error('Voice coding task finished before steering admission')
      await this.recording.record('connection', { type: 'coding-task.steer-applied', requestId }, new AbortController().signal)
      return this.states()
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }

  private owns(parent: SessionRequestId, requestId: SessionRequestId): boolean {
    if (parent === requestId) return true
    return voiceSessionEvents(this.session).some(event => event.type === 'voice/sts/event'
      && event.data.event.type === 'coding-task.steer-requested' && event.data.event.parentRequestId === parent
      && event.data.event.requestId === requestId)
  }

  private intents(): z.infer<typeof intentSchema>[] {
    return voiceSessionEvents(this.session).flatMap((event) => {
      if (event.type !== 'voice/sts/event' || event.data.event.type !== 'coding-task.intent') return []
      return [intentSchema.parse(event.data.event)]
    })
  }
}
