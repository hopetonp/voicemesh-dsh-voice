/** Authenticated provider catalogs filtered for conversational speech sessions. */
import { z } from 'zod'
import { geminiModels } from './gemini-models.ts'

const requestSchema = z.object({ provider: z.enum(['xai', 'gemini', 'openai', 'openai-live']), key: z.string().trim().min(1) }).strict()
const xaiPage = z.object({ data: z.array(z.object({ id: z.string() })) })

/** Fetch live model IDs without returning provider errors or credentials.
 * @param payload Provider and saved API key from the authenticated settings request.
 * @param signal Request cancellation and deadline.
 * @returns Sorted conversational STS model IDs advertised by the provider.
 */
export async function listStsModels(payload: unknown, signal: AbortSignal): Promise<string[]> {
  const { provider, key } = requestSchema.parse(payload)
  const models = new Set<string>()
  if (provider === 'xai' || provider === 'openai' || provider === 'openai-live') {
    const response = await fetch(provider !== 'xai' ? 'https://api.openai.com/v1/models' : 'https://api.x.ai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal, redirect: 'error' })
    if (!response.ok) throw new Error('STS model discovery failed')
    for (const model of xaiPage.parse(await response.json()).data) {
      if (provider !== 'xai') {
        if (!(provider === 'openai-live' ? /^gpt-live-\d/ : /^gpt-realtime(?:$|-(?:mini|\d))/).test(model.id)) continue
        const resolved = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model.id)}`, { headers: { Authorization: `Bearer ${key}` }, signal, redirect: 'error' })
        if (resolved.status === 403 || resolved.status === 404) continue
        if (!resolved.ok) throw new Error('STS model access check failed')
        if (z.object({ id: z.string() }).parse(await resolved.json()).id !== model.id) throw new Error('STS model lookup returned a different model')
        models.add(model.id)
      } else if (model.id.startsWith('grok-voice-')) models.add(model.id)
    }
  } else {
    for (const model of await geminiModels(key, signal)) {
      const id = model.name.replace(/^models\//, '')
      if (model.supportedGenerationMethods?.includes('bidiGenerateContent')
        && !id.startsWith('gemini-2.5-') && /(?:flash-live|native-audio)/.test(id)) models.add(id)
    }
  }
  return [...models].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
}
