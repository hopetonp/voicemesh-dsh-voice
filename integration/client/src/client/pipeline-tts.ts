/** Bidirectional text/audio transport for native streaming TTS providers. */
export async function streamPipelineTts(
  route: string,
  settings: { engine: string; voice: string; timeoutMs: number },
  texts: AsyncIterable<string> | Iterable<string>,
  audio: (pcm: Uint8Array, sampleRate: number) => void,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  const input = (async function* () { yield* texts })()
  const first = await input.next()
  signal.throwIfAborted()
  if (first.done) return
  const url = new URL(`${route}/stream`, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url)
  socket.binaryType = 'arraybuffer'
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  let resolveDone!: () => void
  let rejectDone!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject })
  let sampleRate: number | undefined
  let completed = false
  const fail = (error: unknown): void => { rejectReady(error); rejectDone(error) }
  const abort = (): void => { fail(signal.reason); socket.close() }
  const timer = setTimeout(() => fail(new Error('TTS connection timed out')), settings.timeoutMs)
  signal.addEventListener('abort', abort, { once: true })
  socket.onopen = () => socket.send(JSON.stringify({ type: 'start', engine: settings.engine, voice: settings.voice }))
  socket.onmessage = (event) => {
    try {
      if (signal.aborted) return
      if (event.data instanceof ArrayBuffer) { if (sampleRate === undefined) throw new Error('TTS audio arrived before its format'); audio(new Uint8Array(event.data), sampleRate); return }
      const frame = JSON.parse(String(event.data)) as { type?: string; message?: string; sampleRate?: number }
      if (frame.type === 'ready') {
        if (typeof frame.sampleRate !== 'number' || !Number.isInteger(frame.sampleRate) || frame.sampleRate < 8000 || frame.sampleRate > 192000) throw new Error('Invalid TTS sample rate')
        sampleRate = frame.sampleRate
        clearTimeout(timer); resolveReady()
      }
      else if (frame.type === 'done') { completed = true; resolveDone() }
      else if (frame.type === 'error') fail(new Error(frame.message ?? 'TTS stream failed'))
    } catch (error) { fail(error) }
  }
  socket.onerror = () => fail(new Error('TTS connection failed'))
  socket.onclose = () => { if (!completed) fail(new Error('TTS connection closed before completion')) }
  const sendText = async (): Promise<void> => {
    await ready
    socket.send(JSON.stringify({ type: 'text', text: first.value }))
    for await (const text of input) {
      signal.throwIfAborted()
      socket.send(JSON.stringify({ type: 'text', text }))
    }
    signal.throwIfAborted()
    socket.send(JSON.stringify({ type: 'done' }))
  }
  try { await Promise.all([sendText(), done]) }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); socket.close() }
}
