/** Authenticated, isolated voice preview audio with client-owned cancellation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import { credentialedVoiceRequest } from './voice-credentials.ts'
import { previewVoice } from './voice-preview.ts'
import type { WebSocketConnect } from '@voicemesh/composer'
import type { LocalVoice } from './local-voice.ts'

/**
 * Mount streaming previews without exposing host credentials or joining a chat.
 * @param ctx - authenticated connection owner.
 * @param maxBytes - total audio and socket buffer limit.
 * @param timeoutMs - preview deadline, including connection setup.
 * @param connect - host socket transport for synthesis adapters.
 * @param local - installed local synthesis adapter.
 * @param deepgramRef - host credential reference used by the shared resolver.
 */
export function mountVoicePreviewStream(ctx: Context, maxBytes: number, timeoutMs: number, deepgramRef: string,
  connect: WebSocketConnect, local: Pick<LocalVoice, 'synthesizer'>): void {
  const server = new WebSocketServer({ noServer: true, maxPayload: maxBytes })
  ctx.effect(() => ctx.webServer.registerUpgrade({ path: '/voice-sts/preview', handler(req, socket, head) {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) { socket.end(`HTTP/1.1 ${rejection} Rejected\r\nConnection: close\r\n\r\n`); return }
    server.handleUpgrade(req, socket, head, (browser) => {
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort(); browser.close() }, timeoutMs)
      const send = (frame: unknown): void => {
        if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(frame))
      }
      browser.once('message', (data) => {
        void (async () => {
          const raw = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
          const input = z.object({ provider: z.enum(['openai-live', 'openai', 'gemini', 'xai', 'deepgram', 'fish', 'kokoro']), mode: z.enum(['sts', 'tts']), model: z.string(), voice: z.string().min(1) }).strict().parse(JSON.parse(raw.toString()))
          const request = input.provider === 'kokoro' ? input : await credentialedVoiceRequest(ctx, input, deepgramRef)
          controller.signal.throwIfAborted()
          await previewVoice(request, controller.signal, maxBytes, timeoutMs, connect, (sample) => {
            controller.signal.throwIfAborted()
            if (browser.bufferedAmount > maxBytes) throw new Error('Preview client is too slow')
            send(sample)
          }, local)
          send({ type: 'done' })
          browser.close()
        })().catch(() => { send({ type: 'error' }); browser.close() })
      })
      browser.on('close', () => { clearTimeout(timer); controller.abort() })
      browser.on('error', () => { controller.abort(); browser.close() })
    })
  } }), 'voice-host: streaming voice previews')
  ctx.effect(() => () => { for (const client of server.clients) client.terminate(); server.close() }, 'voice-host: preview cleanup')
}
