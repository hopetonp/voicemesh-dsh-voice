/** Authenticated Pipeline access to the same durable coding tools as realtime voice. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { StsTasks } from './sts-tasks.ts'
import { StsRecording, type StsConversationId } from './sts-recording.ts'

const requestSchema = z.strictObject({
  sessionId: z.string().min(1), conversationId: z.string().uuid(), callId: z.string().min(1).max(256),
  name: z.enum(['dispatch_coding_task', 'get_coding_task_status', 'steer_coding_task', 'stop_coding_task']), args: z.unknown(),
})

/** Create a handler whose per-session controllers serialize concurrent tool admission. */
export function createPipelineTools(ctx: Context): (payload: unknown, signal: AbortSignal) => Promise<unknown> {
  const controllers = new Map<string, { conversationId: string; tasks: StsTasks }>()
  return async (payload, signal) => {
    const input = requestSchema.parse(payload)
    const found = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
    signal.throwIfAborted()
    if ('error' in found) throw new Error('Linked coding session is unavailable')
    let current = controllers.get(input.sessionId)
    if (current === undefined || current.conversationId !== input.conversationId) {
      const session = found.agent.session
      const id = brandString<StsConversationId>(input.conversationId)
      const recording = new StsRecording(id, session, undefined, () => ctx.sessions.flush(session))
      current = { conversationId: input.conversationId, tasks: new StsTasks(session, id, recording, ctx.sessionController) }
      controllers.set(input.sessionId, current)
    }
    switch (input.name) {
      case 'dispatch_coding_task': return current.tasks.dispatch(input.callId, input.args, signal)
      case 'steer_coding_task': return current.tasks.steer(input.callId, input.args, signal)
      case 'stop_coding_task': return current.tasks.stop(input.callId, input.args, signal)
      case 'get_coding_task_status': z.strictObject({}).parse(input.args); return current.tasks.states()
    }
  }
}
