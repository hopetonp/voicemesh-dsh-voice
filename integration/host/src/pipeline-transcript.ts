/** Persist conversational pipeline exchanges in the linked Harness session. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { StsRecording, type StsConversationId } from './sts-recording.ts'

const exchangeSchema = z.strictObject({
  sessionId: z.string().min(1), user: z.string().max(100000), assistant: z.string().max(100000),
  playback: z.strictObject({ id: z.uuid(), phase: z.enum(['start', 'update', 'final']), interrupted: z.boolean() }).optional(),
})

/**
 * Save a local voice answer without submitting another coding task or opening an audio database.
 * @param ctx - authenticated host services.
 * @param payload - linked session and exchange text.
 * @param signal - request cancellation.
 */
export async function savePipelineExchange(ctx: Context, payload: unknown, signal: AbortSignal): Promise<void> {
  const input = exchangeSchema.parse(payload)
  const found = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
  signal.throwIfAborted()
  if ('error' in found) throw new Error('Linked session is unavailable')
  const session = found.agent.session
  const recording = new StsRecording(brandString<StsConversationId>(input.playback?.id ?? randomUUID()), session, undefined,
    () => ctx.sessions.flush(session))
  await recording.recordTranscript('user', input.user, signal, 'user')
  await recording.recordTranscript('assistant', input.assistant, signal, 'assistant', input.playback?.phase, input.playback?.interrupted)
}
