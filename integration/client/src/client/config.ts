/**
 * Persisted voice configuration for the DSH surface.
 *
 * Holds what the user configures on the setup page and survives reloads through
 * the store's localStorage persistence. Mirrors the Flutter voice settings
 * knobs (provider engine ids, voice model, how-much-to-speak, conversational
 * voice replies, VAD, standby, and backchannel).
 *
 * API keys are stored by the host credential service. These fields contain
 * only configured-status markers, never the key values.
 */
import { defineStore, type BakedActions } from '@deepseek-ai/dsh-client-store'
import type { StoreHandle } from '@deepseek-ai/dsh-client-store'

/** What the user configures. */
export interface VoiceConfig {
  /** Provider/mode-scoped favorites selected by the user. */
  voiceFavorites: string[]
  /** Select the existing pipeline or native Grok speech-to-speech. */
  voiceMode: 'pipeline' | 'sts'
  /** Selected native speech provider; credentials are retained independently. */
  stsProvider: 'xai' | 'gemini' | 'openai' | 'openai-live'
  /** Gemini Live credential, separate from xAI. */
  geminiStsCredential: '' | 'gemini-sts'
  /** Gemini Live model and voice requested on the next connection. */
  geminiStsModel: string
  geminiStsVoice: string
  /** OpenAI Realtime credentials and next-connection model and voice. */
  openaiStsCredential: '' | 'openai-sts'
  openaiLiveModel: string
  openaiLiveVoice: string
  openaiStsModel: string
  openaiStsVoice: string
  /** Add STS speech to the optional message-history view. */
  transcriptHistory: boolean
  /** Play connection, disconnection, and standby feedback. */
  statusSounds: boolean
  /** Allow the realtime model to end voice chat on farewell intent. */
  endConversationEnabled: boolean
  /** Placement of voice controls; unsupported panels use the orb. */
  controlLayout: 'orb' | 'panel'
  /** Maximum buffered browser STS wire bytes. */
  stsMaxQueuedBytes: number
  /** Maximum seconds awaiting playback. */
  /** PCM scheduling headroom in seconds; WebRTC owns its own buffering. */
  stsSchedulingLeadSeconds: number
  /** Opening PCM envelope duration in seconds. */
  stsFadeInSeconds: number
  stsMaxQueuedSeconds: number
  /** Maximum generated audio seconds per response. */
  stsMaxResponseSeconds: number
  /** Browser STS microphone buffer size in frames. */
  stsCaptureFrames: number
  /** Initial caption pace before the complete response duration is available. */
  stsCaptionCharactersPerSecond: number
  /** Maximum wait for host persistence before closing a stopped voice socket. */
  stsCloseTimeoutMs: number
  /** Deadline for establishing browser WebRTC media after signaling. */
  stsConnectTimeoutMs: number
  /** Host Deepgram credential status; empty means unconfigured. */
  deepgramCredential: '' | 'deepgram'
  /** Host xAI pipeline credential status. */
  fishCredential: '' | 'fish'
  fishVoice: string
  /** Independent OpenAI pipeline selections; credentials are shared with Realtime. */
  openaiSttModel: string
  openaiTtsModel: string
  openaiTtsVoice: string
  geminiSttModel: string
  geminiTtsModel: string
  geminiTtsVoice: string
  xaiCredential: '' | 'xai'
  /** xAI credential used only by speech-to-speech sessions. */
  stsCredential: '' | 'xai-sts'
  /** Grok realtime model requested for speech-to-speech sessions. */
  stsModel: string
  /** Voice used by speech-to-speech responses. */
  stsVoice: string
  /** Silence before the realtime provider responds, in seconds. */
  liveAudioPollMs: number
  liveAudioThreshold: number
  liveAudioIdleMs: number
  stsSilenceSec: number
  /** Enable provider reasoning before spoken responses. */
  stsThinking: boolean
  /** Master hands-free switch: the loop runs when on. */
  handsFree: boolean
  /** Mute the mic input without stopping the loop. */
  muted: boolean
  /** Read the agent's reply back through TTS. */
  readBack: boolean
  /** STT engine id (the factory's key; Deepgram Flux is first). */
  sttEngine: string
  /** Installed local recognition model ID. */
  localSttModel: string
  /** Installed local synthesis model and speaker ID. */
  localTtsVoice: string
  /** TTS engine id (the factory's key; Deepgram Aura) is first. */
  ttsEngine: string
  /** Deepgram voice model ID; Flux streams, while Aura uses REST synthesis. */
  deepgramVoiceModel: string
  /** Grok TTS voice id used when the TTS engine is Grok. */
  grokVoice: string
  /** Default detail for conversational speech in both voice modes. */
  responseDetail: 'concise' | 'detailed'
  /** Route the reply through a conversational LLM to make it natural to speak. */
  conversationalEnabled: boolean
  /** Legacy preference normalized to false; thinking is disabled by the host. */
  conversationalThinking: boolean
  /** Completed CVM exchanges retained in RAM per active voice session. */
  pipelineContextTurns: number
  /** Maximum tool rounds per spoken turn. */
  pipelineToolRounds: number
  /** Explicit installed host provider ID. */
  conversationalProvider: string
  /** URL preset within the Custom connection settings. */
  conversationalCustomProvider: string
  /** The conversational model id. */
  conversationalModel: string
  /** Last inactive source selections, persisted independently. */
  conversationalHarnessProvider: string
  conversationalHarnessModel: string
  conversationalCustomModel: string
  /** OpenAI-compatible base URL used only for the Custom provider. */
  conversationalBaseUrl: string
  /** Host credential status for the custom endpoint; installed providers own authentication. */
  conversationalCredential: '' | 'conversational'
  /** Seconds of silence before ending speech capture (VAD). */
  vadSilenceSec: number
  /** Seconds of idle before the cloud connection drops into standby. 0 = off. */
  voiceStandbySec: number
  /** Whether quiet acknowledgments ("mhmm") are emitted while the user talks. */
  /** Display live audio levels in the message toolbar. */
  audioVisualizer: boolean
  backchannelEnabled: boolean
  /** Backchannel gain 0..1 (kept under the user's voice). */
  backchannelVolume: number
}

/** The raw (draft-first) write set declared to `defineStore`. A type alias (not
 * an interface) so it carries the implicit index signature the `Record`
 * constraint requires. */
export type VoiceConfigActions = {
  setVoiceFavorites(draft: VoiceConfig, favorites: string[]): void
  setOpenaiLiveModel(draft: VoiceConfig, value: string): void
  setOpenaiLiveVoice(draft: VoiceConfig, value: string): void
  setStsProvider(draft: VoiceConfig, provider: 'xai' | 'gemini' | 'openai' | 'openai-live'): void
  setOpenaiStsCredential(draft: VoiceConfig, configured: boolean): void
  setOpenaiStsModel(draft: VoiceConfig, model: string): void
  setOpenaiStsVoice(draft: VoiceConfig, voice: string): void
  setGeminiStsCredential(draft: VoiceConfig, configured: boolean): void
  setGeminiStsModel(draft: VoiceConfig, model: string): void
  setGeminiStsVoice(draft: VoiceConfig, voice: string): void
  setEndConversationEnabled(draft: VoiceConfig, on: boolean): void
  setControlLayout(draft: VoiceConfig, layout: 'orb' | 'panel'): void
  setVoiceMode(draft: VoiceConfig, mode: 'pipeline' | 'sts'): void
  setDeepgramCredential(draft: VoiceConfig, configured: boolean): void
  setFishCredential(draft: VoiceConfig, configured: boolean): void
  setFishVoice(draft: VoiceConfig, voice: string): void
  setOpenaiSttModel(draft: VoiceConfig, model: string): void
  setOpenaiTtsModel(draft: VoiceConfig, model: string): void
  setOpenaiTtsVoice(draft: VoiceConfig, voice: string): void
  setGeminiSttModel(draft: VoiceConfig, model: string): void
  setGeminiTtsModel(draft: VoiceConfig, model: string): void
  setGeminiTtsVoice(draft: VoiceConfig, voice: string): void
  setXaiCredential(draft: VoiceConfig, configured: boolean): void
  setStsCredential(draft: VoiceConfig, configured: boolean): void
  setStsModel(draft: VoiceConfig, model: string): void
  setStsVoice(draft: VoiceConfig, voice: string): void
  setStsSilenceSec(draft: VoiceConfig, sec: number): void
  setStsThinking(draft: VoiceConfig, on: boolean): void
  setGrokVoice(draft: VoiceConfig, voice: string): void
  setHandsFree(draft: VoiceConfig, on: boolean): void
  setMuted(draft: VoiceConfig, on: boolean): void
  setLocalSttModel(draft: VoiceConfig, id: string): void
  setLocalTtsVoice(draft: VoiceConfig, id: string): void
  setSttEngine(draft: VoiceConfig, id: string): void
  setTtsEngine(draft: VoiceConfig, id: string): void
  setDeepgramVoiceModel(draft: VoiceConfig, voice: string): void
  setResponseDetail(draft: VoiceConfig, detail: 'concise' | 'detailed'): void
  setConversationalSource(draft: VoiceConfig, source: 'harness' | 'custom'): void
  setConversationalProvider(draft: VoiceConfig, id: string): void
  setConversationalCustomProvider(draft: VoiceConfig, id: string): void
  setConversationalModel(draft: VoiceConfig, model: string): void
  setConversationalBaseUrl(draft: VoiceConfig, url: string): void
  setConversationalCredential(draft: VoiceConfig, configured: boolean): void
  setVadSilenceSec(draft: VoiceConfig, sec: number): void
  setVoiceStandbySec(draft: VoiceConfig, sec: number): void
  setAudioVisualizer(draft: VoiceConfig, on: boolean): void
  setBackchannelEnabled(draft: VoiceConfig, on: boolean): void
  setBackchannelVolume(draft: VoiceConfig, vol: number): void
}

/** The baked (draft-stripped) write set the UI calls. */
export type BakedVoiceConfigActions = BakedActions<VoiceConfig, VoiceConfigActions>

/** Default configuration, mirroring the Flutter defaults. */
export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  voiceFavorites: [],
  stsProvider: 'xai',
  geminiStsCredential: '',
  geminiStsModel: 'gemini-3.1-flash-live-preview',
  geminiStsVoice: 'Kore',
  openaiStsCredential: '',
  openaiLiveModel: '',
  openaiLiveVoice: 'marin',
  openaiStsModel: 'gpt-realtime-2.1',
  openaiStsVoice: 'marin',
  voiceMode: 'pipeline',
  stsMaxQueuedBytes: 2097152,
  stsMaxQueuedSeconds: 30,
  stsSchedulingLeadSeconds: 0.04,
  stsFadeInSeconds: 0.01,
  stsMaxResponseSeconds: 300,
  stsCaptureFrames: 1024,
  stsCaptionCharactersPerSecond: 12,
  transcriptHistory: true,
  statusSounds: true,
  endConversationEnabled: false,
  controlLayout: 'orb',
  stsCloseTimeoutMs: 5000,
  stsConnectTimeoutMs: 15000,
  deepgramCredential: '',
  fishCredential: '',
  fishVoice: '',
  openaiSttModel: '',
  openaiTtsModel: '',
  openaiTtsVoice: '',
  geminiSttModel: '',
  geminiTtsModel: '',
  geminiTtsVoice: '',
  xaiCredential: '',
  stsCredential: '',
  stsModel: 'grok-voice-latest',
  stsVoice: 'eve',
  liveAudioPollMs: 100,
  liveAudioThreshold: 0.005,
  liveAudioIdleMs: 350,
  stsSilenceSec: 0.5,
  stsThinking: false,
  handsFree: true,
  muted: false,
  readBack: true,
  sttEngine: 'deepgram-flux',
  localSttModel: '',
  localTtsVoice: '',
  ttsEngine: 'deepgram',
  deepgramVoiceModel: 'flux-haley-en',
  grokVoice: 'eve',
  responseDetail: 'concise',
  conversationalEnabled: true,
  conversationalThinking: false,
  pipelineContextTurns: 8,
  pipelineToolRounds: 4,
  conversationalProvider: 'deepseek-official',
  conversationalCustomProvider: 'manual',
  conversationalModel: '',
  conversationalHarnessProvider: 'deepseek-official',
  conversationalHarnessModel: '',
  conversationalCustomModel: '',
  conversationalBaseUrl: '',
  conversationalCredential: '',
  vadSilenceSec: 1.1,
  voiceStandbySec: 30,
  audioVisualizer: false,
  backchannelEnabled: false,
  backchannelVolume: 0.4,
}

/** The engines the web can actually drive today: Deepgram (Flux STT / Aura TTS)
 * and xAI Grok. Others (Nova, Modulate, AssemblyAI, on-device Whisper) get
 * registry slots as their providers are ported. */
export const STT_ENGINES: readonly { id: string; label: string }[] = [
  { id: 'vosk', label: 'Vosk (local)' },
  { id: 'deepgram-flux', label: 'Deepgram' },
  { id: 'grok', label: 'Grok (xAI)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'fish', label: 'Fish Audio' },
]
export const TTS_ENGINES: readonly { id: string; label: string }[] = [
  { id: 'kokoro', label: 'Kokoro (local)' },
  { id: 'deepgram', label: 'Deepgram' },
  { id: 'grok', label: 'Grok (xAI)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'fish', label: 'Fish Audio' },
]

/**
 * The persisted voice config store handle. Declared in apply (never module
 * scope) so a plugin reload discards the cached identity and keeps the storage
 * key — the same localStorage entry rehydrates on the next apply.
 */
export type VoiceConfigHandle = StoreHandle<VoiceConfig, VoiceConfigActions>

/**
 * Build the voice config store handle. Persisted under a fixed key so the
 * preferences and credential status survive a page reload.
 * @returns a fresh store handle (create() it per apply).
 */
export function createVoiceConfigHandle(): VoiceConfigHandle {
  return defineStore<VoiceConfig, VoiceConfigActions>({
    init: () => ({ ...DEFAULT_VOICE_CONFIG }),
    persist: 'dsh-voice.config',
    actions: {
      setEndConversationEnabled: (d, on: boolean) => { d.endConversationEnabled = on },
      setControlLayout: (d, layout: 'orb' | 'panel') => { d.controlLayout = layout },
      setVoiceMode: (d, mode: 'pipeline' | 'sts') => { d.voiceMode = mode },
      setDeepgramCredential: (d, configured) => { d.deepgramCredential = configured ? 'deepgram' : '' },
      setFishCredential: (d, configured) => { d.fishCredential = configured ? 'fish' : '' },
      setFishVoice: (d, voice: string) => { d.fishVoice = voice },
      setOpenaiSttModel: (d, model: string) => { d.openaiSttModel = model },
      setOpenaiTtsModel: (d, model: string) => { d.openaiTtsModel = model },
      setOpenaiTtsVoice: (d, voice: string) => { d.openaiTtsVoice = voice },
      setGeminiSttModel: (d, model: string) => { d.geminiSttModel = model },
      setGeminiTtsModel: (d, model: string) => { d.geminiTtsModel = model },
      setGeminiTtsVoice: (d, voice: string) => { d.geminiTtsVoice = voice },
      setXaiCredential: (d, configured) => { d.xaiCredential = configured ? 'xai' : '' },
      setOpenaiLiveModel: (d, value) => { d.openaiLiveModel = value.trim() },
      setOpenaiLiveVoice: (d, value) => { d.openaiLiveVoice = value.trim() },
      setStsProvider: (d, provider) => { d.stsProvider = provider },
      setOpenaiStsCredential: (d, configured) => { d.openaiStsCredential = configured ? 'openai-sts' : '' },
      setOpenaiStsModel: (d, model) => { d.openaiStsModel = model.trim() },
      setOpenaiStsVoice: (d, voice) => { d.openaiStsVoice = voice.trim() },
      setGeminiStsCredential: (d, configured) => { d.geminiStsCredential = configured ? 'gemini-sts' : '' },
      setGeminiStsModel: (d, model) => { d.geminiStsModel = model.trim() },
      setGeminiStsVoice: (d, voice) => { d.geminiStsVoice = voice.trim() },
      setStsCredential: (d, configured) => { d.stsCredential = configured ? 'xai-sts' : '' },
      setStsModel: (d, model: string) => { d.stsModel = model.trim() },
      setStsVoice: (d, voice: string) => { d.stsVoice = voice.trim() },
      setStsSilenceSec: (d, sec: number) => { d.stsSilenceSec = sec },
      setStsThinking: (d, on: boolean) => { d.stsThinking = on },
      setVoiceFavorites: (d, favorites: string[]) => { d.voiceFavorites = favorites },
      setGrokVoice: (d, voice: string) => { d.grokVoice = voice },
      setHandsFree: (d, on: boolean) => { d.handsFree = on },
      setMuted: (d, on: boolean) => { d.muted = on },
      setLocalSttModel: (d, id: string) => { d.localSttModel = id },
      setLocalTtsVoice: (d, id: string) => { d.localTtsVoice = id },
      setSttEngine: (d, id: string) => { d.sttEngine = id },
      setTtsEngine: (d, id: string) => { d.ttsEngine = id },
      setDeepgramVoiceModel: (d, voice: string) => { d.deepgramVoiceModel = voice },
      setResponseDetail: (d, detail: 'concise' | 'detailed') => { d.responseDetail = detail },
      setConversationalSource: (d, source: 'harness' | 'custom') => {
        const custom = d.conversationalProvider === 'custom'
        if (custom === (source === 'custom')) return
        if (custom) {
          d.conversationalCustomModel = d.conversationalModel
          d.conversationalProvider = d.conversationalHarnessProvider ?? DEFAULT_VOICE_CONFIG.conversationalHarnessProvider
          d.conversationalModel = d.conversationalHarnessModel ?? ''
        } else {
          d.conversationalHarnessProvider = d.conversationalProvider
          d.conversationalHarnessModel = d.conversationalModel
          d.conversationalProvider = 'custom'
          d.conversationalModel = d.conversationalCustomModel ?? ''
        }
      },
      setConversationalProvider: (d, id: string) => { d.conversationalProvider = id },
      setConversationalCustomProvider: (d, id: string) => { d.conversationalCustomProvider = id },
      setConversationalModel: (d, model: string) => { d.conversationalModel = model },
      setConversationalBaseUrl: (d, url: string) => { d.conversationalBaseUrl = url },
      setConversationalCredential: (d, configured) => { d.conversationalCredential = configured ? 'conversational' : '' },
      setVadSilenceSec: (d, sec: number) => { d.vadSilenceSec = sec },
      setVoiceStandbySec: (d, sec: number) => { d.voiceStandbySec = sec },
      setAudioVisualizer: (d, on: boolean) => { d.audioVisualizer = on },
      setBackchannelEnabled: (d, on: boolean) => { d.backchannelEnabled = on },
      setBackchannelVolume: (d, vol: number) => { d.backchannelVolume = vol },
    },
  })
}

/** Fill missing/undefined fields with defaults (guards legacy persisted configs
 * that predate the newer voice knobs). */
export function normalizeVoiceConfig(partial: Partial<VoiceConfig> = {}): VoiceConfig {
  const out: VoiceConfig = { ...DEFAULT_VOICE_CONFIG }
  for (const key of Object.keys(partial) as (keyof VoiceConfig)[]) {
    const v = partial[key]
    if (key in DEFAULT_VOICE_CONFIG && v !== undefined) (out as unknown as Record<string, unknown>)[key] = v
  }
  out.responseDetail = partial.responseDetail === 'detailed' ? 'detailed' : 'concise'
  out.statusSounds = true
  out.readBack = true
  out.transcriptHistory = true
  out.conversationalEnabled = true
  out.conversationalThinking = false
  if (out.deepgramCredential !== 'deepgram') out.deepgramCredential = ''
  if (out.fishCredential !== 'fish') out.fishCredential = ''
  if (out.xaiCredential !== 'xai') out.xaiCredential = ''
  if (out.stsCredential !== 'xai-sts') out.stsCredential = ''
  if (out.geminiStsCredential !== 'gemini-sts') out.geminiStsCredential = ''
  if (out.openaiStsCredential !== 'openai-sts') out.openaiStsCredential = ''
  if (out.conversationalCredential !== 'conversational') out.conversationalCredential = ''
  if (out.geminiStsModel.replace(/^models\//, '').startsWith('gemini-2.5-')) {
    out.geminiStsModel = DEFAULT_VOICE_CONFIG.geminiStsModel
  }
  for (const value of [out.pipelineContextTurns, out.pipelineToolRounds]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Pipeline conversation limits must be positive integers')
  }
  if (!Number.isFinite(out.stsCaptionCharactersPerSecond) || out.stsCaptionCharactersPerSecond <= 0) {
    throw new Error('STS caption pace must be a positive finite number')
  }
  return out
}

/** URL presets for custom OpenAI-compatible connections; keys remain endpoint-bound on the host. */
export const CUSTOM_CONVERSATIONAL_ENDPOINTS = [
  { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { id: 'grok', label: 'Grok (xAI)', url: 'https://api.x.ai/v1' },
  { id: 'gemini', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com/v1' },
  { id: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1' },
  { id: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
] as const

/** Resolve the selected pipeline model without consulting the Realtime settings.
 * @param config - persisted voice preferences.
 * @param kind - recognition or synthesis.
 * @returns selected model ID, or empty when the provider encodes its model elsewhere.
 */
export function pipelineModel(config: VoiceConfig, kind: 'stt' | 'tts'): string {
  const engine = kind === 'stt' ? config.sttEngine : config.ttsEngine
  if (engine === 'gemini') return kind === 'stt' ? config.geminiSttModel : config.geminiTtsModel
  if (engine === 'openai') return kind === 'stt' ? config.openaiSttModel : config.openaiTtsModel
  return engine === 'vosk' ? config.localSttModel : ''
}

/** Resolve the selected pipeline voice for synthesis, catalogs, and previews.
 * @param config - persisted voice preferences.
 * @returns selected provider voice ID.
 */
export function pipelineVoice(config: VoiceConfig): string {
  switch (config.ttsEngine) {
    case 'gemini': return config.geminiTtsVoice
    case 'openai': return config.openaiTtsVoice
    case 'fish': return config.fishVoice
    case 'kokoro': return config.localTtsVoice
    case 'grok': return config.grokVoice
    default: return config.deepgramVoiceModel
  }
}
