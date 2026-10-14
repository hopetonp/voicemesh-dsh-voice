/** Optional native inference worker. Only the host-selected installed model is loaded. */
import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { kind, model, threads } = workerData
let recognizer
let engine
let completed = ''
let disposing = false
let generating = false
try {
  if (kind === 'stt') {
    const vosk = require('vosk-koffi')
    vosk.setLogLevel(-1)
    engine = new vosk.Model(model.path)
    recognizer = new vosk.Recognizer({ model: engine, sampleRate: 16000 })
    parentPort.postMessage({ type: 'ready' })
  } else {
    const { OfflineTts } = require('sherpa-onnx-node')
    engine = new OfflineTts({ model: { kokoro: model.kokoro, numThreads: threads, provider: 'cpu' }, maxNumSentences: 1 })
    parentPort.postMessage({ type: 'ready', sampleRate: engine.sampleRate, speakers: engine.numSpeakers })
  }
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message })
  parentPort.close()
}
const join = (...texts) => texts.filter(Boolean).join(' ').trim()
const close = () => {
  recognizer?.free()
  if (kind === 'stt') engine?.free()
  recognizer = undefined
  engine = undefined
  parentPort.close()
}
parentPort.on('message', async (request) => {
  try {
    if (request.type === 'dispose') {
      disposing = true
      if (!generating) close()
      return
    }
    if (disposing) return
    if (kind === 'stt') {
      if (request.type === 'audio') {
        const endpoint = recognizer.acceptWaveform(Buffer.from(request.audio))
        if (endpoint) completed = join(completed, recognizer.result().text)
        const text = join(completed, endpoint ? '' : recognizer.partialResult().partial)
        parentPort.postMessage({ id: request.id, type: 'result', text })
      } else if (request.type === 'final') {
        const text = join(completed, recognizer.finalResult().text)
        recognizer.reset()
        completed = ''
        parentPort.postMessage({ id: request.id, type: 'result', text })
      }
    } else if (request.type === 'speak') {
      if (generating) throw new Error('Local synthesis is already active')
      generating = true
      const send = samples => {
        if (!disposing && samples.length) parentPort.postMessage({ id: request.id, type: 'chunk', samples, sampleRate: engine.sampleRate })
      }
      try {
        await engine.generateAsync({ text: request.text, sid: request.speaker, speed: 1, onProgress: ({ samples }) => {
          if (disposing) return 0
          send(samples)
          return 1
        } })
        if (!disposing) {
          parentPort.postMessage({ id: request.id, type: 'audio' })
        }
      } finally {
        generating = false
        if (disposing) close()
      }
    }
  } catch (error) { if (!disposing) parentPort.postMessage({ id: request.id, type: 'error', error: error.message }) }
})
