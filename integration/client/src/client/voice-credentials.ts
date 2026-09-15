/** Write-only credential setup and secret-free browser transports. */

/** Credential purposes remain independent even when two providers accept the same key. */
export type VoiceCredentialSlot = 'fish' | 'deepgram' | 'xai' | 'xai-sts' | 'gemini-sts' | 'openai-sts' | 'conversational'

/** Browser-only legacy key awaiting a one-time authenticated upload. */
export interface LegacyVoiceCredential { slot: VoiceCredentialSlot; value: string; baseUrl?: string }

/** Remove old persisted secrets before the config store rehydrates.
 * @returns transient migration inputs; callers must discard each key after successful upload.
 */
export function takeLegacyVoiceCredentials(): LegacyVoiceCredential[] {
  const raw = localStorage.getItem('dsh-voice.config')
  if (!raw) return []
  const config = JSON.parse(raw) as Record<string, unknown>
  const { deepgramKey, xaiKey, stsKey, geminiStsKey, openaiStsKey, conversationalKey, ...preferences } = config
  const values: [VoiceCredentialSlot, unknown][] = [
    ['deepgram', deepgramKey], ['xai', xaiKey], ['xai-sts', stsKey],
    ['gemini-sts', geminiStsKey], ['openai-sts', openaiStsKey], ['conversational', conversationalKey],
  ]
  const pending: LegacyVoiceCredential[] = []
  for (const [slot, value] of values) {
    if (typeof value !== 'string' || !value.trim()) continue
    pending.push({ slot, value, ...(slot === 'conversational' && typeof config.conversationalBaseUrl === 'string'
      ? { baseUrl: config.conversationalBaseUrl } : {}) })
  }
  localStorage.setItem('dsh-voice.config', JSON.stringify(preferences))
  return pending
}

/** Send an OpenAI-compatible request through the authenticated host without credentials.
 * @param input - provider URL used only to select the host-bound credential and operation.
 * @param init - request body and cancellation; provider headers are never forwarded.
 * @param fetchImpl - same-origin HTTP transport.
 * @returns streaming response from the host.
 */
export function fetchViaVoiceHost(input: string, init: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const match = /^(.*)\/(chat\/completions|models)$/.exec(input)
  if (!match) throw new Error('Unsupported conversational operation')
  if (init.body !== undefined && typeof init.body !== 'string') throw new Error('Conversational body must be JSON text')
  const { voiceSessionId, ...body } = init.body ? JSON.parse(init.body) as Record<string, unknown> : {}
  return fetchImpl('/api/voice/conversational', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, ...(init.signal === undefined ? {} : { signal: init.signal }),
    body: JSON.stringify({ provider: /^https?:\/\//.test((match[1] ?? '')) ? 'custom' : match[1], ...(/^https?:\/\//.test((match[1] ?? '')) ? { baseUrl: match[1] } : {}), operation: match[2],
      ...(voiceSessionId === undefined ? {} : { sessionId: voiceSessionId }),
      ...(init.body ? { body } : {}) }),
  })
}
