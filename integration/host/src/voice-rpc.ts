import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection'

type RpcResult = { ok: true; value?: unknown; attachments?: { kind: string; bytes: Uint8Array }[] }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
type VoiceHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult>

const endpoints: Record<string, readonly string[]> = {
  '/voice-credentials': ['status', 'save'],
  '/voice-local': ['models', 'wake-keywords', 'install-size', 'install', 'install-status', 'wake-readiness'],
  '/voice-sts': ['models', 'voices', 'voice-preview', 'pipeline-models', 'probe'],
  '/voice-pipeline': ['exchange', 'tool'],
}

/** Extend the existing authenticated API without reconfiguring Connection. */
export function registerVoiceRpc(connection: HostConnectionService, channel: string, handler: VoiceHandler): () => Promise<void> {
  const methods = endpoints[channel]
  if (!methods) throw new Error('Unknown voice RPC channel')
  const disposers = methods.map(endpoint => {
    const method = `${channel.slice(1)}/${endpoint}`
    return connection.fetch.register({
      path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
          return new Response('content type must be application/json', { status: 415 })
        }
        let input: unknown
        try { input = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }
        const message = input as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown } | null
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
        const failure = (code: string, text: string) => Response.json({ type: 'server-response', rpcId,
          result: { ok: false, error: { code, message: text, details: {} } } })
        if (!message || typeof message !== 'object' || Array.isArray(message)
          || message.type !== 'client-request' || typeof message.rpcId !== 'string' || typeof message.method !== 'string') {
          return failure('gateway/bad-request', 'invalid client-request message')
        }
        if (message.method !== method) return failure('gateway/bad-request', 'method does not match endpoint')
        let result: RpcResult
        try { result = await handler(endpoint, message.payload, request.signal) }
        catch { return failure('voice/rpc', 'Voice operation failed') }
        if (!result.ok || !result.attachments?.length) return Response.json({ type: 'server-response', rpcId, result })
        const { attachments, ...success } = result
        const form = new FormData()
        const metadata = attachments.map((attachment, index) => {
          const part = `bytes-${index}`
          form.set(part, new Blob([new Uint8Array(attachment.bytes)]))
          return { kind: attachment.kind, codec: 'bytes', part }
        })
        form.set('metadata', JSON.stringify({ type: 'server-response', rpcId, result: success, attachments: metadata }))
        return new Response(form)
      },
    })
  })
  return async () => { await Promise.all(disposers.map(dispose => dispose())) }
}
