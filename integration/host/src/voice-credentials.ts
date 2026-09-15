/** Host-owned voice credentials; browser operations return configuration status only. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createHash } from 'node:crypto'
import { z } from 'zod'

const slotSchema = z.enum(['fish', 'deepgram', 'xai', 'xai-sts', 'gemini-sts', 'openai-sts', 'conversational'])
const requestSchema = z.object({ slot: slotSchema, baseUrl: z.string().optional() }).strict()
const saveSchema = z.object({
  slot: slotSchema, baseUrl: z.string().optional(), value: z.string().trim().max(4096), migrate: z.boolean().optional(),
}).strict()
const refs = {
  fish: 'FISH_API_KEY', deepgram: 'DEEPGRAM_API_KEY', xai: 'DSH_VOICE_XAI_KEY', 'xai-sts': 'DSH_VOICE_XAI_STS_KEY',
  'gemini-sts': 'DSH_VOICE_GEMINI_STS_KEY', 'openai-sts': 'DSH_VOICE_OPENAI_STS_KEY',
}

/** Normalize the endpoint to which a conversational credential may be sent.
 * @param value - user-selected OpenAI-compatible API base URL.
 * @returns canonical base URL; rejects credentials, queries, fragments, and non-HTTP protocols.
 */
export function conversationalBase(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid conversational endpoint')
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote conversational endpoints require HTTPS')
  return url.href.replace(/\/$/, '')
}

/** Resolve a voice-owned reference; CVM keys are bound to the exact configured endpoint.
 * @param slot - voice credential purpose.
 * @param baseUrl - required for the conversational model.
 * @param deepgramRef - deployment-owned Deepgram reference.
 * @returns host credential reference.
 */
export function voiceCredentialRef(
  slot: z.infer<typeof slotSchema>, baseUrl?: string, deepgramRef = refs.deepgram,
): ReturnType<typeof credentialRef> {
  return credentialRef(slot === 'conversational'
    ? `DSH_VOICE_CVM_${createHash('sha256').update(conversationalBase(baseUrl ?? '')).digest('hex').toUpperCase()}`
    : slot === 'deepgram' ? deepgramRef : refs[slot])
}

/** Read a provider key exclusively on the host.
 * @param ctx - context with the harness credential service.
 * @param slot - voice credential purpose.
 * @param baseUrl - CVM destination when applicable.
 * @param deepgramRef - deployment-owned Deepgram reference.
 * @returns configured secret, or null.
 */
export async function readVoiceCredential(
  ctx: Context, slot: z.infer<typeof slotSchema>, baseUrl?: string, deepgramRef = refs.deepgram,
): Promise<string | null> {
  return (await ctx.credentials.resolve(voiceCredentialRef(slot, baseUrl, deepgramRef)))?.value ?? null
}

/** Apply a setup operation without returning a secret or provider diagnostic.
 * @param ctx - authenticated connection context with credentials.
 * @param endpoint - status or save.
 * @param payload - validated purpose and optional write-only key.
 * @param deepgramRef - deployment-owned Deepgram reference.
 * @returns configured status; migration refuses to replace a different existing credential.
 */
export async function voiceCredentialOperation(
  ctx: Context, endpoint: string, payload: unknown, deepgramRef = refs.deepgram,
): Promise<{ configured: boolean }> {
  if (endpoint === 'status') {
    const input = requestSchema.parse(payload)
    const info = await ctx.credentials.describe(voiceCredentialRef(input.slot, input.baseUrl, deepgramRef))
    return { configured: info.configured }
  }
  if (endpoint !== 'save') throw new Error('Unknown credential operation')
  const input = saveSchema.parse(payload)
  const ref = voiceCredentialRef(input.slot, input.baseUrl, deepgramRef)
  if (input.migrate) {
    const current = await ctx.credentials.resolve(ref)
    if (current) {
      if (current.value !== input.value) throw new Error('Stored voice credential differs from browser credential')
      return { configured: true }
    }
  }
  if (input.value === '') await ctx.credentials.unset(ref)
  else await ctx.credentials.set(ref, input.value)
  return { configured: (await ctx.credentials.describe(ref)).configured }
}

/** Supply a resolved key to provider helpers after rejecting browser-supplied keys.
 * @param ctx - host credential owner.
 * @param input - browser provider selection, never a secret.
 * @param deepgramRef - deployment-owned Deepgram reference.
 * @returns provider input with its host-resolved key.
 */
export async function credentialedVoiceRequest(
  ctx: Context, input: unknown, deepgramRef = refs.deepgram,
): Promise<Record<string, unknown>> {
  const selected = z.object({
    provider: z.enum(['fish', 'deepgram', 'xai', 'gemini', 'openai', 'openai-live']), mode: z.enum(['sts', 'tts']).optional(),
  }).parse(input)
  if (typeof input !== 'object' || input === null || 'key' in input) throw new Error('Browser voice requests cannot supply keys')
  const slot = selected.provider === 'openai-live' ? 'openai-sts' : selected.provider === 'fish' ? 'fish' : selected.provider === 'deepgram' ? 'deepgram' : selected.provider === 'xai' && selected.mode === 'tts' ? 'xai' : `${selected.provider}-sts` as const
  const key = await readVoiceCredential(ctx, slot, undefined, deepgramRef)
  return { ...input, key: key ?? '' }
}
