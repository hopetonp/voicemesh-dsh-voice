/** Identify saved credentials required by the currently selected voice path. */
import type { VoiceCredentialSlot } from './voice-credentials.ts'
import type { VoiceConfig } from './config.ts'
import { resolveStsSettings } from './sts-settings.ts'

/** Return every missing host credential the active voice mode will use. */
export function missingVoiceCredentials(config: VoiceConfig): readonly VoiceCredentialSlot[] {
  if (config.voiceMode === 'sts') {
    if (resolveStsSettings(config).credential !== '') return []
    return [config.stsProvider === 'xai' ? 'xai-sts' : config.stsProvider === 'gemini' ? 'gemini-sts' : 'openai-sts']
  }
  const missing = new Set<VoiceCredentialSlot>()
  const addEngine = (engine: string): void => {
    if ((engine === 'deepgram-flux' || engine === 'deepgram') && config.deepgramCredential === '') missing.add('deepgram')
    if (engine === 'grok' && config.xaiCredential === '') missing.add('xai')
    if (engine === 'fish' && config.fishCredential === '') missing.add('fish')
    if (engine === 'openai' && config.openaiStsCredential === '') missing.add('openai-sts')
    if (engine === 'gemini' && config.geminiStsCredential === '') missing.add('gemini-sts')
  }
  addEngine(config.sttEngine)
  addEngine(config.ttsEngine)
  if (config.conversationalProvider === 'custom' && config.conversationalBaseUrl !== '' && config.conversationalCredential === '') missing.add('conversational')
  return [...missing]
}
