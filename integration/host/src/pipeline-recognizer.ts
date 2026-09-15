/** Convert the browser microphone clock to the selected recognition provider clock. */
import { buildRecognizer, pcm16ToFloats, type WebSocketConnect, type KeyReader, type TurnStreamingRecognizer } from '@voicemesh/composer'
import libsamplerate from '@alexanderolsen/libsamplerate-js'

/** Resolve a recognizer accepting browser PCM16 at 16 kHz.
 * @param engine - selected provider ID.
 * @param connect - host socket transport.
 * @param key - host credential reader.
 * @param model - selected recognition model.
 * @returns recognizer with rate conversion scoped to each utterance, or null.
 */
export function pipelineRecognizer(engine: string, connect: WebSocketConnect, key: KeyReader,
  model?: string): TurnStreamingRecognizer | null {
  const recognizer = buildRecognizer(engine, connect, key, model) as TurnStreamingRecognizer | null
  if (!recognizer || recognizer.inputSampleRate === 16000) return recognizer
  const inputSampleRate = recognizer.inputSampleRate
  async function* converted(chunks: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
    const converter = await libsamplerate.create(1, 16000, inputSampleRate)
    let carry: number | undefined
    const encode = (samples: Float32Array): Uint8Array => {
      const bytes = new Uint8Array(samples.length * 2)
      const view = new DataView(bytes.buffer)
      samples.forEach((sample, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1,
        sample)) * (sample < 0 ? 32768 : 32767)), true))
      return bytes
    }
    try {
      for await (const chunk of chunks) {
        const joined = carry === undefined ? chunk : Uint8Array.from([carry, ...chunk])
        carry = joined.length % 2 ? joined.at(-1) : undefined
        const aligned = joined.subarray(0, joined.length - joined.length % 2)
        if (aligned.length) yield encode(converter.full(pcm16ToFloats(aligned)))
      }
      if (carry !== undefined) throw new Error('Incomplete microphone PCM sample')
      // The streaming converter retains filter history; silence drains the final speech samples.
      yield encode(converter.full(new Float32Array(1600)))
    } finally { converter.destroy() }
  }
  const transcribe = async (bytes: Uint8Array): Promise<string> => {
    let text = ''
    for await (const turn of recognizer.turnStream(converted((async function* () { yield bytes })()))) text = turn.transcript
    return text
  }
  return { id: recognizer.id, label: recognizer.label, inputSampleRate: 16000,
    availabilityProblem: () => recognizer.availabilityProblem(), transcribe,
    checkEndpoint: async bytes => ({ text: await transcribe(bytes), isEndpoint: true }),
    turnStream: (chunks, signal) => recognizer.turnStream(converted(chunks), signal), dispose: () => recognizer.dispose(),
  }
}
