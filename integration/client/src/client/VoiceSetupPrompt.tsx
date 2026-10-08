/** Enable-time guidance for a bundle whose selected voice path is incomplete. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { isLocalSttEngine, localSttEngine, normalizeVoiceConfig, pipelineModel, pipelineVoice, type VoiceConfig } from './config.ts'
import { resolveStsSettings } from './sts-settings.ts'
import type { LocalVoiceModel } from './voice-catalog.ts'
import { missingVoiceCredentials } from './voice-credential-readiness.ts'

/** Values shared with the existing setup form. */
export interface VoiceSetupPromptInjected {
  readonly sources: {
    readonly config: { getSnapshot(): VoiceConfig; subscribe(listener: () => void): () => void }
    /** Initial host credential-status scan has settled, whether it succeeded or failed. */
    readonly credentialStatusReady: { getSnapshot(): boolean; subscribe(listener: () => void): () => void }
  }
  readonly listLocalModels?: (signal: AbortSignal) => Promise<LocalVoiceModel[]>
}

/** Inputs provided by the activation slot and this plugin's existing setup services. */
export type VoiceSetupPromptProps = PropsRuntime<'plugins.bundle.activation'> & PropsLocale<'voice'> & VoiceSetupPromptInjected

/** Whether selected local engines have the model material they need on this host. */
function localEnginesReady(config: VoiceConfig, models: readonly LocalVoiceModel[]): boolean {
  const sttReady = !isLocalSttEngine(config.sttEngine)
    || (config.localSttModel !== '' && models.some(model => model.kind === 'stt'
      && model.id === config.localSttModel && model.engine === localSttEngine(config.sttEngine)))
  const selectedTtsModel = pipelineVoice(config).split(':', 1)[0]
  const ttsReady = config.ttsEngine !== 'kokoro'
    || (selectedTtsModel !== '' && models.some(model => model.kind === 'tts' && model.id === selectedTtsModel))
  return sttReady && ttsReady
}

/** Decide readiness from persisted selections and free local inventory only. */
export function needsVoiceSetup(config: VoiceConfig, models: readonly LocalVoiceModel[] | undefined): boolean {
  if (config.voiceMode === 'sts') {
    const { credential, model, voice } = resolveStsSettings(config)
    return !credential || !model || !voice
  }
  if (!config.sttEngine || !config.ttsEngine || !config.conversationalProvider || !config.conversationalModel) return true
  if (missingVoiceCredentials(config).length !== 0) return true
  if (config.conversationalProvider === 'custom' && (!config.conversationalBaseUrl || config.conversationalCredential !== 'conversational')) return true
  if ((config.sttEngine === 'openai' || config.sttEngine === 'gemini') && !pipelineModel(config, 'stt')) return true
  if ((config.ttsEngine === 'openai' || config.ttsEngine === 'gemini') && (!pipelineModel(config, 'tts') || !pipelineVoice(config))) return true
  if (config.ttsEngine !== 'kokoro' && config.ttsEngine !== 'openai' && config.ttsEngine !== 'gemini' && !pipelineVoice(config)) return true
  return models !== undefined && !localEnginesReady(config, models)
}

/** Offer setup after bundle enablement, without provider probes or microphone access. */
export function VoiceSetupPrompt({ sources, listLocalModels, onDismiss, onOpenDetails, t }: VoiceSetupPromptProps): JSX.Element | null {
  const config = normalizeVoiceConfig(useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot))
  const credentialStatusReady = useSyncExternalStore(sources.credentialStatusReady.subscribe, sources.credentialStatusReady.getSnapshot)
  const usesLocal = isLocalSttEngine(config.sttEngine) || config.ttsEngine === 'kokoro'
  const [models, setModels] = useState<readonly LocalVoiceModel[] | undefined>(usesLocal ? undefined : [])
  useEffect(() => {
    if (!usesLocal || !listLocalModels) { setModels([]); return }
    const controller = new AbortController()
    void listLocalModels(controller.signal).then(setModels).catch(() => { if (!controller.signal.aborted) setModels([]) })
    return () => controller.abort()
  }, [usesLocal, listLocalModels])
  const incomplete = needsVoiceSetup(config, models)
  useEffect(() => {
    if (models !== undefined && !incomplete) onDismiss()
  }, [models, incomplete, onDismiss])
  if (!credentialStatusReady || models === undefined || !incomplete) return null
  return <Modal open title={t('setup.title')} closeLabel={t('setup.later')} onClose={onDismiss}
    footer={<>
      <Button variant="ghost" onClick={onDismiss}>{t('setup.later')}</Button>
      <Button variant="primary" onClick={onOpenDetails}>{t('setup.open')}</Button>
    </>}>
    <p>{t('setup.body')}</p>
  </Modal>
}
