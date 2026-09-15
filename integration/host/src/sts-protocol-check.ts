/** Synthetic realtime tool admission and later-result exchange, without a coding agent. */
import { z } from 'zod'

const doneSchema = z.object({
  response: z.object({
    status: z.literal('completed'),
    output: z.array(z.looseObject({ type: z.string() })),
  }),
})
const callSchema = z.object({
  type: z.literal('function_call'),
  name: z.literal('dispatch_coding_task'),
  call_id: z.string().min(1),
  arguments: z.string(),
})
const argsSchema = z.object({ instruction: z.string().min(1) }).strict()

/** Fixed diagnostic instructions and tool schema; no user context is included. */
export const protocolCheckSession = {
  instructions: 'This is a protocol diagnostic. When asked, call dispatch_coding_task once. After acceptance say only "Task accepted". After receiving the later completion update say only "The test task completed". Do not call tools again.',
  tools: [{
    type: 'function', name: 'dispatch_coding_task',
    description: 'Simulate accepting a coding task. This diagnostic never executes code.',
    parameters: { type: 'object', properties: { instruction: { type: 'string' } }, required: ['instruction'], additionalProperties: false },
  }],
}

function textItem(text: string): object {
  return { type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }
}

/** One isolated diagnostic exchange, advancing only on completed responses. */
export class StsProtocolCheck {
  private stage: 'call' | 'acceptance' | 'completion' = 'call'
  private audio = false

  /**
   * Start the synthetic coding request.
   * @returns ordered provider events to send after session.updated.
   */
  start(): readonly object[] {
    return [textItem('Call dispatch_coding_task to simulate checking a test repository.'), { type: 'response.create' }]
  }

  /**
   * Observe provider output and produce the next diagnostic exchange.
   * @param event - parsed provider JSON event.
   * @returns terminal readiness or ordered outbound messages.
   */
  accept(event: Record<string, unknown>): boolean | readonly object[] {
    if (event.type === 'response.output_audio.delta') {
      const delta = event.delta
      if (typeof delta !== 'string' || delta.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(delta)) return false
      const bytes = Buffer.from(delta, 'base64')
      if (bytes.length === 0 || bytes.length % 2 !== 0) return false
      this.audio = true
      return []
    }
    if (event.type !== 'response.done') return []
    const done = doneSchema.safeParse(event)
    if (!done.success) return false
    const calls = done.data.response.output.filter(item => item.type === 'function_call')
    if (this.stage === 'call') {
      if (calls.length !== 1) return false
      const call = callSchema.safeParse(calls[0])
      if (!call.success) return false
      let args: unknown
      try { args = JSON.parse(call.data.arguments) }
      catch { return false }
      if (!argsSchema.safeParse(args).success) return false
      this.stage = 'acceptance'
      this.audio = false
      return [{
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id: call.data.call_id, output: JSON.stringify({ status: 'accepted', request: 'diagnostic-task' }) },
      }, { type: 'response.create' }]
    }
    if (calls.length !== 0 || !this.audio) return false
    if (this.stage === 'completion') return true
    this.stage = 'completion'
    this.audio = false
    return [textItem('Coding task update: diagnostic-task completed successfully. This is a simulated result, not a new task. Announce completion.'), { type: 'response.create' }]
  }
}
