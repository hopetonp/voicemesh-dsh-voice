/** Provider-specific settings resolved before acquiring voice resources. */
import type { VoiceConfig } from './config.ts'
import { createOpenaiWebRtcAdapter } from '@voicemesh/composer/browser'
import type { StsWebRtcAdapter } from '@voicemesh/composer/browser'

/** Select provider-owned WebRTC event translation. @param provider - configured provider identity. @returns connection-local adapter. */
export function createStsWebRtcAdapter(provider: VoiceConfig['stsProvider'], config?: VoiceConfig): StsWebRtcAdapter {
  if (provider === 'openai-live') return { channelLabel: 'oai-events', ...(config === undefined ? {} : { activity: { pollMs: config.liveAudioPollMs, threshold: config.liveAudioThreshold, idleMs: config.liveAudioIdleMs } }), decode: () => [] }
  if (provider === 'openai') return createOpenaiWebRtcAdapter()
  throw new Error('Provider does not support WebRTC')
}

/**
 * Select saved credentials and audio clock for the requested native provider.
 * @param config - normalized voice configuration.
 * @returns provider connection values for live startup and diagnostics.
 */
export function resolveStsSettings(config: VoiceConfig): { transport: 'websocket' | 'webrtc'; provider: 'xai' | 'gemini' | 'openai' | 'openai-live'; credential: string; model: string; voice: string; inputSampleRate: number; outputSampleRate: number } {
  if (config.stsProvider === 'openai-live') return { transport: 'webrtc', provider: 'openai-live', credential: config.openaiStsCredential, model: config.openaiLiveModel, voice: config.openaiLiveVoice, inputSampleRate: 24000, outputSampleRate: 24000 }
  if (config.stsProvider === 'openai') return { transport: 'webrtc', provider: 'openai', credential: config.openaiStsCredential, model: config.openaiStsModel, voice: config.openaiStsVoice, inputSampleRate: 24000, outputSampleRate: 24000 }
  return config.stsProvider === 'gemini'
    ? { transport: 'websocket', provider: 'gemini' as const, credential: config.geminiStsCredential, model: config.geminiStsModel, voice: config.geminiStsVoice, inputSampleRate: 16000, outputSampleRate: 24000 }
    : { transport: 'websocket', provider: 'xai' as const, credential: config.stsCredential, model: config.stsModel, voice: config.stsVoice, inputSampleRate: 16000, outputSampleRate: 24000 }
}
