/** Browser CacheStorage adapter for reusable preview caching. */
import { cachedPreviews } from '@voicemesh/composer'
import { parseVoiceSample, type VoiceCatalogActions } from './voice-catalog.ts'

/**
 * Persist complete provider previews across page reloads.
 * @param generate - Authenticated preview generator.
 * @returns Cached preview generator.
 */
export function cacheVoicePreviews(generate: VoiceCatalogActions['previewVoice']): VoiceCatalogActions['previewVoice'] {
  const url = (key: string): string => new URL(`/voice-preview-cache/${encodeURIComponent(key)}`, location.origin).href
  return cachedPreviews(generate, {
    async load(key) {
      const cache = await caches.open('dsh-voice-previews-v1')
      const response = await cache.match(url(key))
      if (!response) return undefined
      const value: unknown = await response.json()
      if (!Array.isArray(value) || value.length === 0) throw new Error('Invalid cached voice preview')
      return value.map(parseVoiceSample)
    },
    async save(key, samples) {
      const cache = await caches.open('dsh-voice-previews-v1')
      await cache.put(url(key), new Response(JSON.stringify(samples), { headers: { 'Content-Type': 'application/json' } }))
    },
  }, (selection, voice) => JSON.stringify([selection.provider, selection.mode, selection.model, voice]))
}
