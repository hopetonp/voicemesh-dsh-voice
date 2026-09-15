/** Authenticated CVM HTTP streaming with credentials resolved only on the host. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { once } from 'node:events'
import { z } from 'zod'
import { requestVoiceModel } from './conversational-model.ts'

const requestSchema = z.strictObject({ provider: z.string().min(1).optional(), baseUrl: z.string().optional(), sessionId: z.string().min(1).optional(), operation: z.enum(['models', 'chat/completions']), body: z.record(z.string(), z.unknown()).optional() })

/** Mount the browser's CVM transport; redirects cannot move a credential to another destination.
 * @param ctx - host context with WebServer and credentials.
 * @param maxBytes - maximum browser request size.
 * @param timeoutMs - maximum provider request duration.
 */
export function mountConversationalProxy(ctx: Context, maxBytes: number, timeoutMs: number): void {
  let modelContext = ctx
  ctx.inject(['sessionController', 'llm'], (ready) => {
    ready.effect(() => { modelContext = ready; return () => { modelContext = ctx } }, 'voice-host: installed conversational model services')
  })
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'voice-host: CVM request lifetime')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/api/voice/conversational', async handler(req, res) {
    const connection = ctx.get('connection')
    const rejection = connection ? connection.requestRejection(req) : 401
    if (rejection !== undefined) { res.statusCode = rejection; res.end('{}'); return }
    if (req.method !== 'POST') { res.statusCode = 405; res.end('{}'); return }
    const controller = new AbortController()
    const disconnected = (): void => { controller.abort() }
    res.on('close', disconnected)
    const signal = AbortSignal.any([controller.signal, lifetime.signal, AbortSignal.timeout(timeoutMs)])
    try {
      let length = 0
      const chunks: Uint8Array[] = []
      for await (const chunk of req) {
        if (!(chunk instanceof Uint8Array)) throw new Error('Invalid request bytes')
        const bytes = new Uint8Array(chunk)
        length += bytes.length
        if (length > maxBytes) { res.statusCode = 413; res.end('{}'); return }
        chunks.push(bytes)
      }
      const input = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (input.baseUrl !== undefined && input.provider !== 'custom') throw new Error('Only custom providers accept an endpoint')
      const upstream = await requestVoiceModel(modelContext, input, signal)
      res.statusCode = upstream.status
      if (!upstream.ok) {
        // Only the rejected parameter category crosses back; upstream diagnostics may echo a key.
        const detail = (await upstream.text()).toLowerCase()
        const reasoning = /reasoning[_\s]?effort/.test(detail)
          && /not support|unsupported|not allowed|not permitted|invalid|unknown|unrecognized/.test(detail)
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: { message: reasoning ? 'Unsupported reasoning_effort' : `Conversational provider HTTP ${upstream.status}` } }))
        return
      }
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      if (!upstream.body) { res.end(); return }
      const reader = upstream.body.getReader()
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (!res.write(chunk.value)) await once(res, 'drain', { signal })
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      res.end()
    } catch (error) {
      if (process.env.DSH_VOICE_DEBUG === '1' && error instanceof Error) console.warn('[voice-conversational] failed', error.name, error.stack?.split('\n').slice(1, 4).join('\n'))
      if (!res.headersSent) { res.statusCode = 502; res.end(JSON.stringify({ error: { message: 'Conversational host request failed' } })) }
      else res.destroy()
    } finally { res.off('close', disconnected) }
  } }), 'voice-host: authenticated CVM proxy')
}
