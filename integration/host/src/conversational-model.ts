/** Installed conversational models with host-owned authentication and OpenAI-compatible streaming. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createMessage, createToolResultMessage, ToolCallId, type Message, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { resolveAdapterOptions, type Config as DeepSeekConfig } from '@deepseek-ai/dsh-llm-deepseek'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { readVoiceCredential, conversationalBase } from './voice-credentials.ts'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { StsConversationId } from './sts-recording.ts'

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.string().nullable(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    extra_content: z.object({ voiceReplay: z.unknown(), voiceProvider: z.string(), voiceModel: z.string() }).optional(),
    function: z.object({ name: z.string(), arguments: z.string() }),
  })).optional(),
})
const completionSchema = z.object({
  messages: z.array(messageSchema), stream: z.boolean().optional(),
  tools: z.array(z.object({ function: z.object({
    name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown()),
  }) })).optional(),
  temperature: z.number().optional(), max_tokens: z.number().int().positive().optional(),
})

/** Explicit installed provider selection; session identity is only for request recording. */
export interface VoiceModelRequest {
  provider?: string | undefined
  baseUrl?: string | undefined
  operation: 'models' | 'chat/completions'
  body?: Record<string, unknown> | undefined
  sessionId?: string | undefined
}

/** Request an explicitly selected installed conversational model using host-owned authentication.
 * @param ctx - installed provider registry and optional linked session services.
 * @param input - model catalog or conversational completion request.
 * @param signal - caller cancellation and host deadline.
 * @returns an OpenAI-compatible response; never resolves a coding-model fallback.
 */
export async function requestVoiceModel(ctx: Context, input: VoiceModelRequest, signal: AbortSignal): Promise<Response> {
  if (input.provider === 'custom') return requestCustomModel(ctx, input, signal)
  if (input.operation === 'models') {
    const warnings: string[] = []
    const providers = await Promise.all(ctx.llm.listProviders().map(async (provider) => {
      try {
        const registered = await ctx.llm.listModels(provider.id)
        let discovered: { id: string; name: string }[] = []
        try { discovered = await discoverVoiceModels(ctx, provider.id, signal) }
        catch { warnings.push(provider.name) }
        const models = [...new Map([...registered, ...discovered].map(model => [model.id, model])).values()]
        const eligible = await Promise.all(models.map(async (model) => {
          const info = await ctx.llm.resolveModelInfo(provider.id, model.id)
          return info.reasoning === undefined || info.reasoning.efforts.some(effort => effort.id === 'off' || effort.id === 'none')
            ? { id: model.id, name: model.name } : null
        }))
        return { id: provider.id, name: provider.name, models: eligible.filter(model => model !== null) }
      } catch { warnings.push(provider.name); return { id: provider.id, name: provider.name, models: [] } }
    }))
    return Response.json({ providers: providers.filter(provider => provider.models.length > 0), ...(warnings.length ? { message: 'Additional model discovery unavailable: ' + [...new Set(warnings)].join(', ') } : {}) })
  }
  const selected = { provider: z.string().trim().min(1).parse(input.provider), model: z.string().trim().min(1).parse(input.body?.model) }
  const info = await ctx.llm.resolveModelInfo(selected.provider, selected.model)
  const off = info.reasoning?.efforts.find(effort => effort.id === 'off' || effort.id === 'none')
  if (info.reasoning !== undefined && off === undefined) throw new Error('Selected conversational model does not support thinking off')
  const body = completionSchema.parse(input.body)
  const system = body.messages.filter(message => message.role === 'system').map(message => message.content ?? '').join('\n\n')
  const messages: Message[] = body.messages.filter(message => message.role !== 'system').map((message) => {
    if (message.role === 'tool') return createToolResultMessage({
      callId: ToolCallId(z.string().min(1).parse(message.tool_call_id)),
      content: [{ type: 'text', text: message.content ?? '' }], isError: false,
    })
    const replay = message.tool_calls?.[0]?.extra_content
    return createMessage({ role: message.role,
      source: message.role === 'assistant'
        ? { kind: 'model', provider: replay?.voiceProvider ?? selected.provider, model: replay?.voiceModel ?? selected.model,
          ...(replay === undefined ? {} : { replayState: replay.voiceReplay }) }
        : { kind: 'user' },
      content: [
        ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
        ...(message.tool_calls ?? []).map(call => ({ type: 'tool-call' as const, id: ToolCallId(call.id), name: call.function.name, arguments: call.function.arguments })),
      ],
    })
  })
  const options: GenerateOptions = {
    provider: selected.provider, model: selected.model, system,
    ...(off === undefined ? {} : { reasoningEffort: off.id }), messages, signal,
    ...(body.tools === undefined ? {} : { tools: body.tools.map(tool => tool.function) }),
    ...(body.temperature === undefined ? {} : { temperature: body.temperature }),
    ...(body.max_tokens === undefined ? {} : { maxTokens: body.max_tokens }),
  }
  if (input.sessionId !== undefined) {
    const found = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
    signal.throwIfAborted()
    if ('error' in found) throw new Error('Linked voice session is unavailable')
    const { signal: _signal, ...recorded } = options
    found.agent.session.append('voice/sts/event', {
      conversationId: brandString<StsConversationId>(randomUUID()), direction: 'input',
      event: { type: 'pipeline.model.request', ...recorded },
    })
  }
  return completionResponse(ctx.llm.stream(options), body.stream === true, signal, selected)
}

/** Forward an explicitly configured OpenAI-compatible endpoint using its host-bound key. */
async function requestCustomModel(ctx: Context, input: VoiceModelRequest, signal: AbortSignal): Promise<Response> {
  const base = conversationalBase(input.baseUrl ?? '')
  if (input.operation === 'models') {
    const key = await readVoiceCredential(ctx, 'conversational', base)
    return fetch(base + '/models', { headers: key ? { Authorization: 'Bearer ' + key } : {}, redirect: 'error', signal })
  }
  const model = z.string().trim().min(1).parse(input.body?.model)
  const body = completionSchema.extend({
    messages: z.array(z.record(z.string(), z.unknown())),
    tools: z.array(z.record(z.string(), z.unknown())).optional(),
  }).parse(input.body)
  if (input.sessionId) {
    const found = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
    if ('error' in found) throw new Error('Linked voice session is unavailable')
    found.agent.session.append('voice/sts/event', { conversationId: brandString<StsConversationId>(randomUUID()), direction: 'input', event: { type: 'pipeline.model.request', provider: 'custom', model, ...body } })
  }
  const key = await readVoiceCredential(ctx, 'conversational', base)
  const send = (reasoning: boolean): Promise<Response> => fetch(base + '/chat/completions', {
    method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
    body: JSON.stringify({ ...body, model, ...(reasoning ? { reasoning_effort: 'none' } : {}) }),
  })
  const response = await send(true)
  if (response.status !== 400 && response.status !== 422) return response
  const detail = (await response.clone().text()).toLowerCase()
  if (!/reasoning[_\s]?effort/.test(detail)
    || !/not support|unsupported|not allowed|invalid|unknown|unrecognized/.test(detail)) return response
  await response.body?.cancel()
  return send(false)
}

/** Expand an installed route through its discovery service or configured DeepSeek endpoint. */
async function discoverVoiceModels(ctx: Context, provider: string, signal: AbortSignal): Promise<{ id: string; name: string }[]> {
  const entry = ctx.llm.listConfigurableProviders().find(item => item.provider === provider)
  if (!entry) return []
  if (entry.settingsNs !== 'llm-deepseek') {
    try {
      return (await ctx.llm.discoverModels(entry.settingsNs, { provider }, signal)).map(model => (
        { id: model.id, name: model.name ?? model.id }))
    } catch (error) {
      // Installed adapters without endpoint discovery retain their registered catalog.
      if (error instanceof Error && 'code' in error && error.code === 'NO_DISCOVERY') return []
      throw error
    }
  }
  const settings = resolveAdapterOptions(ctx.get('settings')?.get('llm-deepseek') as DeepSeekConfig, launchEnvironmentOf(ctx))
  const credential = await ctx.credentials.resolve(settings.apiKeyEnv)
  const response = await fetch(conversationalBase(settings.baseURL) + '/models', {
    headers: credential ? { Authorization: 'Bearer ' + credential.value } : {}, redirect: 'error', signal,
  })
  if (!response.ok) throw new Error('Conversational model discovery failed')
  const result = z.object({ data: z.array(z.object({ id: z.string().min(1) })) }).parse(await response.json())
  return result.data.map(model => ({ id: model.id, name: model.id }))
}

/** Project an independent provider call into the voice client's chat-completions protocol. */
function completionResponse(
  chunks: ReturnType<Context['llm']['stream']>, streaming: boolean, signal: AbortSignal, selected: { provider: string; model: string },
): Response {
  const iterator = chunks[Symbol.asyncIterator]()
  let content = ''
  let finishReason: string | undefined
  const calls = new Map<number, { id: string; type: 'function'; extra_content?: unknown; function: { name: string; arguments: string } }>()
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        for (;;) {
          signal.throwIfAborted()
          const next = await iterator.next()
          if (next.done) {
            if (finishReason === undefined) throw new Error('Voice model stream ended without a finish event')
            controller.enqueue(encoder.encode(streaming ? 'data: [DONE]\n\n' : JSON.stringify({ choices: [{ message: { content, tool_calls: [...calls.values()] }, finish_reason: finishReason }] })))
            controller.close()
            return
          }
          const chunk = next.value
          let delta: Record<string, unknown> | undefined
          if (chunk.type === 'text-delta') { content += chunk.text; delta = { content: chunk.text } }
          if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
            const block = chunk.block
            const call = { id: block.id, type: 'function' as const,
              function: { name: block.name, arguments: block.arguments } }
            calls.set(chunk.index, call)
            // Harness deltas repeat complete names; completed blocks supply authoritative IDs and arguments.
            delta = { tool_calls: [{ index: chunk.index, ...call }] }
          }
          if (chunk.type === 'finish') {
            switch (chunk.reason.kind) {
              case 'stop': finishReason = 'stop'; break
              case 'tool-calls': finishReason = 'tool_calls'; break
              case 'max-tokens': finishReason = 'length'; break
              case 'error': case 'aborted': throw new Error('Voice model request failed')
              // Provider extensions must not turn an unknown outcome into successful completion.
              default: throw new Error('Unsupported voice model finish reason')
            }
          }
          if (chunk.type === 'finish' && chunk.replayState !== undefined && calls.size > 0) {
            const first = calls.entries().next().value
            if (first === undefined) throw new Error('Missing voice tool call')
            first[1].extra_content = { voiceReplay: chunk.replayState, voiceProvider: selected.provider, voiceModel: selected.model }
            delta = { tool_calls: [{ index: first[0], id: first[1].id, extra_content: first[1].extra_content }] }
          }
          if (streaming && (delta !== undefined || chunk.type === 'finish')) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: delta ?? {}, ...(chunk.type === 'finish' ? { finish_reason: finishReason } : {}) }] })}\n\n`))
            return
          }
        }
      } catch (error) { await iterator.return?.(); controller.error(error) }
    },
    async cancel() { await iterator.return?.() },
  })
  return new Response(stream, { headers: { 'Content-Type': streaming ? 'text/event-stream' : 'application/json' } })
}
