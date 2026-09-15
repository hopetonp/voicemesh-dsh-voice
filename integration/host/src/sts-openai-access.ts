/** Key-scoped resolution of both models used by OpenAI voice. */
import { z } from 'zod'

const transcriptionFamilies = ['gpt-live-transcribe', 'gpt-realtime-whisper', 'gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1']

/**
 * Resolve accessible speech and caption models using the same request credential.
 * @param key - request-only OpenAI credential.
 * @param model - selected conversational model.
 * @param signal - startup cancellation and deadline.
 * @returns an input-transcription model resolved for this key.
 */
export async function resolveOpenaiStsAccess(key: string, model: string, signal: AbortSignal): Promise<string> {
  const options = { headers: { Authorization: `Bearer ${key}` }, signal, redirect: 'error' as const }
  const speech = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, options)
  if (!speech.ok) throw new Error('The selected key cannot resolve the OpenAI speech model')
  if (z.object({ id: z.string() }).parse(await speech.json()).id !== model) throw new Error('OpenAI model lookup returned a different model')
  const response = await fetch('https://api.openai.com/v1/models', options)
  if (!response.ok) throw new Error('OpenAI transcription discovery failed')
  const catalog = z.object({ data: z.array(z.object({ id: z.string() })) }).parse(await response.json()).data.map(entry => entry.id)
  for (const family of transcriptionFamilies) {
    const candidates = catalog.filter(id => id === family || id.startsWith(`${family}-20`)).sort((a, b) => b.localeCompare(a))
    for (const id of candidates) {
      const resolved = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(id)}`, options)
      if (resolved.status === 403 || resolved.status === 404) continue
      if (!resolved.ok) throw new Error('OpenAI transcription access check failed')
      if (z.object({ id: z.string() }).parse(await resolved.json()).id !== id) throw new Error('OpenAI model lookup returned a different model')
      return id
    }
  }
  throw new Error('The selected key cannot resolve an OpenAI transcription model')
}
