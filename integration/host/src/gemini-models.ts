/** Shared paginated Gemini model discovery using host-owned credentials. */
import { z } from 'zod'
const pageSchema = z.object({
  models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() })).optional(),
  nextPageToken: z.string().optional(),
})

/** Fetch Gemini model metadata without returning credentials or remote diagnostics.
 * @param key - host-owned Gemini credential.
 * @param signal - request cancellation and deadline.
 * @returns deduplicated models advertised by Google.
 */
export async function geminiModels(key: string, signal: AbortSignal): Promise<{ name: string
  supportedGenerationMethods?: string[] | undefined }[]> {
  const models = new Map<string, { name: string; supportedGenerationMethods?: string[] | undefined }>()
  const visited = new Set<string>()
  let token: string | undefined
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    url.searchParams.set('pageSize', '1000')
    if (token) url.searchParams.set('pageToken', token)
    const response = await fetch(url, { headers: { 'x-goog-api-key': key }, signal, redirect: 'error' })
    if (!response.ok) throw new Error('Gemini model discovery failed')
    const page = pageSchema.parse(await response.json())
    for (const model of page.models ?? []) models.set(model.name, model)
    token = page.nextPageToken || undefined
    if (token) { if (visited.has(token)) throw new Error('Gemini catalog repeated a page'); visited.add(token) }
  } while (token)
  return [...models.values()]
}

/** Discover Gemini pipeline models with the required speech transport.
 * @param key - host-owned Gemini credential.
 * @param kind - recognition or synthesis.
 * @param signal - discovery cancellation and deadline.
 * @returns live transcription or streaming TTS models confirmed by individual lookup.
 */
export async function listGeminiSpeechModels(key: string, kind: 'stt' | 'tts', signal: AbortSignal): Promise<string[]> {
  const candidates = (await geminiModels(key, signal)).filter(model => kind === 'stt'
    ? /-transcribe-live(?:$|-)/.test(model.name) && model.supportedGenerationMethods?.includes('bidiGenerateContent')
    : /-tts(?:$|-)/.test(model.name) && streamingTts(model.name) && model.supportedGenerationMethods?.includes('generateContent'))
  const resolved = await Promise.all(candidates.map(async (model) => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${model.name}`, {
      headers: { 'x-goog-api-key': key }, signal, redirect: 'error',
    })
    if (response.status === 403 || response.status === 404) return undefined
    if (!response.ok || z.object({ name: z.string() }).parse(await response.json()).name !== model.name) throw new Error('Gemini speech model access check failed')
    return model.name.replace(/^models\//, '')
  }))
  return resolved.filter((model): model is string => model !== undefined).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
}

/** Google supports TTS streaming starting with Gemini 3.1. */
function streamingTts(name: string): boolean {
  const version = /^models\/gemini-(\d+)\.(\d+)-/.exec(name)
  return version !== null && (Number(version[1]) > 3 || (Number(version[1]) === 3 && Number(version[2]) >= 1))
}
