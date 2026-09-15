import { readVoiceCredential } from './voice-credentials.ts'
/** Authenticated incremental text-to-audio transport for Pipeline speech. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { SpeechTextQueue, buildSynthesizer, type WebSocketConnect } from '@voicemesh/composer'
import { WebSocketServer, WebSocket } from 'ws'
import { z } from 'zod'

const startSchema = z.strictObject({ type: z.literal('start'), engine: z.enum(['deepgram', 'grok', 'fish']), voice: z.string().min(1).max(128) })
const textSchema = z.strictObject({ type: z.literal('text'), text: z.string().min(1).max(32000) })

/** Mount one authenticated, cancellable synthesis socket per spoken response. */
export function mountPipelineTts(ctx: Context, path: string, connect: WebSocketConnect, maxBytes: number, timeoutMs: number, deepgramRef = 'DEEPGRAM_API_KEY'): void {
  const server = new WebSocketServer({ noServer: true, maxPayload: maxBytes })
  ctx.effect(() => ctx.webServer.registerUpgrade({ path, handler(req, socket, head) {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) { socket.end(`HTTP/1.1 ${rejection} Rejected\r\nConnection: close\r\n\r\n`); return }
    server.handleUpgrade(req, socket, head, (browser) => {
      const queue = new SpeechTextQueue()
      let synth: ReturnType<typeof buildSynthesizer>
      let started = false
      let ended = false
      let textBytes = 0
      let timer = setTimeout(() => browser.close(1008, 'Speech input timeout'), timeoutMs)
      const send = (frame: unknown): void => { if (browser.readyState === WebSocket.OPEN) browser.send(JSON.stringify(frame)) }
      const fail = (error: unknown): void => {
        queue.fail(error)
        synth?.stop()
        send({ type: 'error', message: (error as Error).message })
        browser.close()
      }
      browser.on('message', (data, binary) => {
        void handleMessage(data, binary)
      })
      const handleMessage = async (data: { toString(): string }, binary: boolean): Promise<void> => {
        try {
          clearTimeout(timer)
          timer = setTimeout(() => browser.close(1008, 'Speech input timeout'), timeoutMs)
          if (binary) throw new Error('Expected text synthesis input')
          const input: unknown = JSON.parse(data.toString())
          if (!started) {
            const start = startSchema.parse(input)
            if (start.engine === 'deepgram' && !start.voice.startsWith('flux-')) throw new Error('This voice uses sentence synthesis')
            started = true
            const key = await readVoiceCredential(ctx, start.engine === 'fish' ? 'fish' : start.engine === 'grok' ? 'xai' : 'deepgram', undefined, deepgramRef)
            if (browser.readyState !== WebSocket.OPEN) return
            if (!key) throw new Error('TTS credential is not configured')
            synth = buildSynthesizer(start.engine, connect, () => key,
              async () => { throw new Error('Unexpected REST synthesis') },
              (bytes) => { if (browser.readyState === WebSocket.OPEN) browser.send(bytes) }, start.voice)
            if (synth?.speakStream === undefined) throw new Error('Provider does not support streaming text')
            started = true
            send({ type: 'ready', sampleRate: synth.outputSampleRate })
            void synth.speakStream(queue).then(() => { send({ type: 'done' }); browser.close() }, fail)
            return
          }
          if (ended) throw new Error('Speech input is already complete')
          if (typeof input === 'object' && input !== null && 'type' in input && input.type === 'done') {
            z.strictObject({ type: z.literal('done') }).parse(input)
            ended = true
            clearTimeout(timer)
            queue.close()
          } else {
            const frame = textSchema.parse(input)
            textBytes += Buffer.byteLength(frame.text)
            if (textBytes > maxBytes) throw new Error('Speech text exceeds configured limit')
            queue.push(frame.text)
          }
        } catch (error) { fail(error) }
      }
      browser.on('close', () => { clearTimeout(timer); queue.fail(new Error('Speech connection closed')); synth?.stop() })
      browser.on('error', fail)
    })
  } }), 'voice-host: Pipeline streaming TTS')
  ctx.effect(() => () => { for (const client of server.clients) client.terminate(); server.close() }, 'voice-host: Pipeline TTS cleanup')
}
