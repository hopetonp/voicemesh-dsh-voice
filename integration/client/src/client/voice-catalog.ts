/** Wire results for provider-owned voice discovery and isolated sample playback. */
export interface VoiceSelection {
  readonly provider: 'xai' | 'deepgram' | 'openai' | 'openai-live' | 'gemini' | 'kokoro' | 'fish'
  readonly mode: 'sts' | 'tts'
  readonly model: string
  /** Fish catalog language; empty selects all, absent uses the app locale. */
  readonly language?: string
}

/** Published metadata; empty fields mean the provider did not supply them. */
export interface CatalogVoice {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly languages: readonly string[]
  readonly gender: string
  readonly region: string
}

/** A freshly fetched catalog with source attribution. */
export interface VoiceCatalog {
  /** Effective Fish request filter, supplied by the client locale adapter. */
  readonly filterLanguage?: string
  readonly voices: readonly CatalogVoice[]
  readonly source: 'api' | 'documentation'
  readonly sourceUrl: string
  readonly fetchedAt: string
  readonly supplementalSourceUrl?: string
}

/** Preview PCM16 is mono and little endian. */
export interface VoiceSample {
  readonly audio: string
  readonly sampleRate: number
}

/** Operations shared by the STS and TTS pickers. Credentials remain in the settings adapter. */
export interface VoiceCatalogActions {
  /** Fetch the current catalog for the selected service. */
  listVoices(selection: VoiceSelection, signal: AbortSignal): Promise<VoiceCatalog>
  /** Synthesize a sample without joining the conversation. */
  previewVoice(selection: VoiceSelection, voice: string, signal: AbortSignal, onAudio: (sample: VoiceSample) => void): Promise<void>
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const isVoice = (value: unknown): value is CatalogVoice => object(value) && typeof value.id === 'string' && value.id !== ''
  && typeof value.name === 'string' && typeof value.description === 'string' && strings(value.languages)
  && typeof value.gender === 'string' && typeof value.region === 'string'

/**
 * Validate catalog data received over RPC.
 * @param value - RPC payload.
 * @returns catalog suitable for display.
 */
export function parseVoiceCatalog(value: unknown): VoiceCatalog {
  if (!object(value) || !Array.isArray(value.voices) || !value.voices.every(isVoice)
    || (value.source !== 'api' && value.source !== 'documentation')
    || typeof value.sourceUrl !== 'string' || !value.sourceUrl.startsWith('https://')
    || (value.supplementalSourceUrl !== undefined && (typeof value.supplementalSourceUrl !== 'string'
      || !value.supplementalSourceUrl.startsWith('https://')))
    || typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))
    || new Set(value.voices.map(voice => voice.id)).size !== value.voices.length) throw new Error('Invalid voice catalog')
  return { ...(typeof value.supplementalSourceUrl === 'string' ? { supplementalSourceUrl: value.supplementalSourceUrl } : {}), voices: value.voices, source: value.source, sourceUrl: value.sourceUrl, fetchedAt: value.fetchedAt }
}

/**
 * Validate sample metadata before allocating playback buffers.
 * @param value - RPC payload.
 * @returns bounded PCM16 sample.
 */
export function parseVoiceSample(value: unknown): VoiceSample {
  if (!object(value) || typeof value.audio !== 'string' || value.audio.length === 0
    || typeof value.sampleRate !== 'number' || !Number.isInteger(value.sampleRate) || value.sampleRate < 8000 || value.sampleRate > 192000
    || value.audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.audio)) {
    throw new Error('Invalid voice sample')
  }
  return { audio: value.audio, sampleRate: value.sampleRate }
}

/** Installed local speech-model metadata. */
export interface LocalVoiceModel { id: string; name: string; kind: 'stt' | 'tts' | 'kws'; languages: string[]; engine?: 'vosk' | 'parakeet' }

/**
 * Validate the host's installed-model list, keeping each model's recognition engine.
 *
 * The settings page filters installed models by engine, so the engine has to survive this
 * validation: a copied field list would drop it and leave a local engine with no selectable model.
 * @param value - decoded `/voice-local` `models` value.
 * @returns installed models in the shape the settings page reads.
 */
export function parseLocalModels(value: readonly unknown[]): LocalVoiceModel[] {
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string'
      || !('name' in item) || typeof item.name !== 'string' || !('kind' in item) || (item.kind !== 'stt' && item.kind !== 'tts' && item.kind !== 'kws')
      || !('languages' in item) || !Array.isArray(item.languages) || !item.languages.every((v: unknown) => typeof v === 'string')) {
      throw new Error('Invalid local model metadata')
    }
    const engine = 'engine' in item && (item.engine === 'vosk' || item.engine === 'parakeet') ? item.engine : undefined
    return { id: item.id, name: item.name, kind: item.kind, languages: item.languages as string[],
      ...(engine === undefined ? {} : { engine }) }
  })
}

/**
 * Capitalize displayed voice words while preserving provider spelling and acronyms.
 * @param name - provider name or fallback identifier.
 * @returns display label; never use it as a provider identifier.
 */
export function voiceDisplayName(name: string): string {
  return name.replace(/(^|[\s_-])(\p{L})/gu, (_match, separator: string, letter: string) => separator + letter.toUpperCase())
}
