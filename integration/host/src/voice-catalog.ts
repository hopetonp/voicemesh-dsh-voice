/** Live provider voice catalogs; documentation extraction has no bundled fallback list. */
import { z } from 'zod'

/** Authenticated voice discovery and preview selection. */
export const voiceRequest = z.object({
  provider: z.enum(['deepgram', 'xai', 'openai', 'openai-live', 'gemini', 'fish']), mode: z.enum(['sts', 'tts']),
  key: z.string().max(4096), model: z.string().max(128), voice: z.string().trim().max(128).optional(),
  language: z.string().max(35).regex(/^(?:[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*)?$/).optional(),
})

/** Provider metadata preserved without inferring unsupported demographic attributes. */
export interface CatalogVoice {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly languages: readonly string[]
  readonly gender: string
  readonly region: string
}

/** Current discovery result and its provenance. */
export interface VoiceCatalog {
  readonly voices: readonly CatalogVoice[]
  readonly source: 'api' | 'documentation'
  readonly sourceUrl: string
  readonly fetchedAt: string
  readonly supplementalSourceUrl?: string
}

/**
 * Read a bounded remote body.
 * @param response - upstream response.
 * @param maxBytes - body limit.
 * @returns response bytes.
 */
export async function readVoiceBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.ok || response.body === null) throw new Error('Voice provider request failed')
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maxBytes) throw new Error('Voice provider response exceeds its limit')
      parts.push(next.value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  return Buffer.concat(parts)
}

const metadata = (id: string, name = id, description = ''): CatalogVoice => ({ id, name, description, languages: [], gender: '', region: '' })

/**
 * Extract only the published voice section; changed markup fails without guessing.
 * @param provider - documentation owner.
 * @param body - current official document.
 * @param mode - speech-to-speech or text-to-speech catalog.
 * @param model - selected model, including legacy TTS voice restrictions.
 * @returns voice identifiers and published descriptions.
 */
export function parseDocumentVoices(provider: 'openai' | 'openai-live' | 'gemini' | 'deepgram', body: string, mode: 'sts' | 'tts' = 'sts', model = ''): CatalogVoice[] {
  let voices: CatalogVoice[]
  if (provider === 'openai-live') {
    const section = /### Voice options\s+([\s\S]*?)(?=\n### |$)/.exec(body)?.[1] ?? ''
    voices = section.split('\n').flatMap((line) => {
      const cells = line.split('|').map(cell => cell.trim())
      const id = /^`([a-z][a-z0-9_-]*)`$/.exec(cells[2] ?? '')?.[1]
      return id === undefined ? [] : [{ ...metadata(id, cells[1], cells[4]), region: cells[4] ?? '', gender: cells[5] ?? '' }]
    })
  } else if (provider === 'deepgram') {
    voices = body.split('\n').flatMap((line) => {
      const cells = line.split('|').map(cell => cell.trim())
      const id = /^`(flux-[a-z0-9-]+)`$/.exec(cells[2] ?? '')?.[1]
      return id === undefined ? [] : [{ ...metadata(id, cells[1] ?? id, cells[6] ?? ''),
        languages: [id.split('-').at(-1) ?? ''], gender: cells[4] ?? '', region: cells[3] ?? '' }]
    })
  } else if (provider === 'openai') {
    const section = /### Voice options\s+([\s\S]*?)(?=\n### |$)/.exec(body)?.[1]
    const sentence = section === undefined ? undefined : /Current voice options are ([^.]+)\./.exec(section)?.[1]
    const legacy = section === undefined ? undefined : /models support a smaller set: ([^.]+)\./.exec(section)?.[1]
    const text = mode === 'tts' ? (model.startsWith('tts-1') ? legacy : section?.split('For best quality')[0]) : sentence
    const pattern = mode === 'tts' && !model.startsWith('tts-1') ? /^- `([a-z][a-z0-9_-]*)`/gm : /`([a-z][a-z0-9_-]*)`/g
    voices = text === undefined ? [] : [...text.matchAll(pattern)].map(match => metadata(match[1] ?? ''))
  } else {
    const section = /<h2\b[^>]*id="voices"[^>]*>[\s\S]*?<table>([\s\S]*?)<\/table>/.exec(body)?.[1]
    const cellPattern = /<td>\s*<b>([A-Za-z][A-Za-z0-9_-]*)<\/b>\s*--\s*<em>([^<>]+)<\/em>\s*<\/td>/g
    const cells = section === undefined ? [] : [...section.matchAll(cellPattern)]
    voices = cells.map(match => metadata(match[1] ?? '', match[1] ?? '', match[2] ?? ''))
  }
  if (voices.length === 0 || new Set(voices.map(voice => voice.id)).size !== voices.length) throw new Error('Official voice catalog could not be extracted')
  return voices
}

/**
 * Discover voices from the provider API or its current official documentation.
 * @param input - provider, mode, model, and saved key.
 * @param signal - caller cancellation and deadline.
 * @param maxBytes - maximum fetched document or API body.
 * @returns current catalog with explicit source attribution.
 */
export async function discoverVoices(input: unknown, signal: AbortSignal, maxBytes: number): Promise<VoiceCatalog> {
  const request = voiceRequest.parse(input)
  if (request.provider === 'fish') {
    if (request.mode !== 'tts' || !request.key.trim()) throw new Error('Fish voices require TTS mode and a key')
    const voices = new Map<string, CatalogVoice>()
    const row = z.object({ _id: z.string().min(1), title: z.string(), description: z.string().nullish(),
      type: z.string(), state: z.string(), languages: z.array(z.string()).default([]) })
    const pageSchema = z.object({ items: z.array(row), total: z.number().int().nonnegative(), has_more: z.boolean().nullish() })
    let remaining = maxBytes
    for (const scope of ['licensed=true', 'self=true']) {
      for (let page = 1; ; page++) {
        const language = request.language ? `&language=${encodeURIComponent(request.language)}&title_language=${encodeURIComponent(request.language)}` : ''
        const url = `https://api.fish.audio/model?${scope}&page_size=100&page_number=${page}${language}`
        const bytes = await readVoiceBody(await fetch(url, {
          headers: { Authorization: `Bearer ${request.key}` }, signal, redirect: 'error',
        }), remaining)
        remaining -= bytes.length
        const result = pageSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
        for (const voice of result.items) {
          if (voice.type === 'tts' && voice.state === 'trained') voices.set(voice._id, { ...metadata(voice._id, voice.title, voice.description ?? ''), languages: voice.languages })
        }
        if (result.has_more === false || result.items.length === 0 || (result.has_more == null && page * 100 >= result.total)) break
      }
    }
    return { voices: [...voices.values()], source: 'api', sourceUrl: 'https://api.fish.audio/model', fetchedAt: new Date().toISOString() }
  }
  if (request.provider === 'deepgram' && request.mode !== 'tts') throw new Error('Unsupported voice mode')
  const documentation = request.provider === 'openai-live' || request.provider === 'openai' || request.provider === 'gemini'
  const sourceUrl = request.provider === 'openai-live' ? 'https://developers.openai.com/api/docs/guides/live-conversations.md' : request.provider === 'openai' ? new URL(request.mode === 'tts' ? 'text-to-speech.md' : 'realtime-conversations.md', 'https://developers.openai.com/api/docs/guides/').href
    : request.provider === 'gemini' ? 'https://ai.google.dev/gemini-api/docs/speech-generation?hl=en'
      : request.provider === 'xai' ? 'https://api.x.ai/v1/tts/voices' : 'https://api.deepgram.com/v1/models'
  if (!documentation && request.key.trim() === '') throw new Error('Voice catalog requires a key')
  const headers = documentation ? {} : { Authorization: `${request.provider === 'deepgram' ? 'Token' : 'Bearer'} ${request.key}` }
  const body = new TextDecoder().decode(await readVoiceBody(await fetch(sourceUrl, { headers, signal, redirect: 'error' }), maxBytes))
  let voices: CatalogVoice[]
  let supplementalSourceUrl: string | undefined
  if (request.provider === 'openai-live' || request.provider === 'openai' || request.provider === 'gemini') voices = parseDocumentVoices(request.provider, body, request.mode, request.model)
  else if (request.provider === 'xai') {
    const row = z.object({ voice_id: z.string().min(1), name: z.string(), description: z.string().nullish() })
    const parsed = z.object({ voices: z.array(row) }).parse(JSON.parse(body))
    voices = parsed.voices.map(voice => metadata(voice.voice_id, voice.name, voice.description ?? ''))
  } else {
    const parsed = z.object({ tts: z.array(z.object({
      canonical_name: z.string().min(1), name: z.string(), languages: z.array(z.string()).optional(),
      metadata: z.object({ accent: z.string().optional(), tags: z.array(z.string()).optional() }).optional(),
    })) }).parse(JSON.parse(body))
    voices = parsed.tts.map(voice => ({ ...metadata(voice.canonical_name, voice.name, voice.metadata?.tags?.join(' · ') ?? ''),
      languages: voice.languages ?? [], region: voice.metadata?.accent ?? '', gender: '',
    }))
  }
  if (request.provider === 'deepgram') {
    supplementalSourceUrl = new URL('voices.md', 'https://developers.deepgram.com/docs/flux-tts/').href
    const response = await fetch(supplementalSourceUrl, { signal, redirect: 'error' })
    const flux = parseDocumentVoices('deepgram', new TextDecoder().decode(await readVoiceBody(response, maxBytes)))
    const known = new Set(voices.map(voice => voice.id))
    voices.push(...flux.filter(voice => !known.has(voice.id)))
  }
  return { voices, ...(supplementalSourceUrl === undefined ? {} : { supplementalSourceUrl }), source: documentation ? 'documentation' : 'api', sourceUrl, fetchedAt: new Date().toISOString() }
}
