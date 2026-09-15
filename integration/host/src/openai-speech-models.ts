/** Key-resolved OpenAI pipeline models; discovery never substitutes an inaccessible alias. */
import { z } from 'zod'

/** Discover compatible speech model IDs for the saved credential.
 * @param key - host-owned OpenAI credential.
 * @param kind - recognition or synthesis.
 * @param signal - request deadline and cancellation.
 * @returns model IDs confirmed by individual model lookup.
 */
export async function listOpenaiSpeechModels(key: string, kind: 'stt' | 'tts', signal: AbortSignal): Promise<string[]> {
  const options = { headers: { Authorization: `Bearer ${key}` }, signal, redirect: 'error' as const }
  const response = await fetch('https://api.openai.com/v1/models', options)
  if (!response.ok) throw new Error('OpenAI speech model discovery failed')
  const catalog = z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await response.json()).data
  const families = kind === 'stt' ? ['gpt-live-transcribe', 'gpt-realtime-whisper', 'gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']
    : ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd']
  const matches = catalog.map(row => row.id).filter(id => families.some(family => id === family || new RegExp(`^${family}-\\d{4}(?:-\\d{2}-\\d{2})?$`).test(id)))
  const resolved = await Promise.all(matches.map(async (id) => {
    const result = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(id)}`, options)
    if (result.status === 403 || result.status === 404) return undefined
    if (!result.ok || z.object({ id: z.string() }).parse(await result.json()).id !== id) throw new Error('OpenAI speech model access check failed')
    return id
  }))
  return resolved.filter((id): id is string => id !== undefined).sort((a, b) => {
    const familyIndex = (id: string): number => families.findIndex(family => id === family || id.startsWith(`${family}-20`))
    return familyIndex(a) - familyIndex(b) || b.localeCompare(a)
  })
}
