import type { VoiceCredentialSlot } from './voice-credentials.ts'
import { voiceDisplayName, type LocalVoiceModel } from './voice-catalog.ts'
/** Voice preferences, write-only host credential setup, and provider diagnostics. */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconChevronDownOutline14, Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { resolveStsSettings } from './sts-settings.ts'
import type { VoiceConfig, BakedVoiceConfigActions } from './config.ts'
import { STT_ENGINES, TTS_ENGINES, normalizeVoiceConfig, CUSTOM_CONVERSATIONAL_ENDPOINTS, pipelineModel, pipelineVoice } from './config.ts'
import type { SttHealth, ConversationalHealth, ConversationalModels } from './dsh-transport.ts'
import type { VoicePhaseState } from './state.ts'
import css from './VoiceSettings.module.css'
import { SelectedVoiceControl } from './SelectedVoiceControl.tsx'
import { CredentialField } from './CredentialField.tsx'
import { ConnectionSettings } from './ConnectionSettings.tsx'
import { VoicePicker } from './VoicePicker.tsx'
import type { VoiceCatalogActions, VoiceSelection } from './voice-catalog.ts'

/** The injected face of the setup page (assembled in apply). */
export interface VoiceSettingsInjected extends VoiceCatalogActions {
  sources: {
    voice: ObservableSnapshot<VoicePhaseState>
    config: ObservableSnapshot<VoiceConfig>
  }
  /** Save a write-only key on the host; the promise settles after durable storage. */
  saveCredential: (slot: VoiceCredentialSlot, value: string) => Promise<void>
  actions: BakedVoiceConfigActions
  /** Verify Grok accepts the configured STS session settings. */
  probeSts: (protocol?: boolean) => Promise<boolean>
  /** Discover key-accessible OpenAI recognition or synthesis models. */
  listPipelineModels?: (provider: 'openai' | 'gemini', kind: 'stt' | 'tts', signal: AbortSignal) => Promise<string[]>
  /** Discover installed native speech models. */
  listLocalModels?: (signal: AbortSignal) => Promise<LocalVoiceModel[]>
  /** Discover conversational STS models for the selected provider and saved key. */
  listStsModels: (signal: AbortSignal) => Promise<string[]>
  /** Probe the selected STT provider’s connectivity/auth with the current key. */
  probe(): Promise<SttHealth>
  /** Probe the configured conversational model (reachability + key + model). */
  probeConversational: () => Promise<ConversationalHealth>
  /** List the configured endpoint's advertised models (provider model picker). */
  listConversationalModels: () => Promise<ConversationalModels>
  /** Synthesize a fixed read-back test phrase. */
  testTts(): Promise<void>
}

/** Full props of the setup page. */
export type VoiceSettingsProps =
  SettingsSectionOwnerProps
  & VoiceSettingsInjected
  & PropsLocale<'voice'>

/** The test phrase spoken by the read-back test. */
export const READ_BACK_TEST = 'This is a voice test. Can you hear me?'

/** One option in a `SelectField` dropdown. */
interface SelectOption<Value extends string = string> {
  value: Value
  label: string
}

/** Engine ids that consume the Deepgram credential for recognition. */
const DEEPGRAM_STT_IDS = new Set(['deepgram-flux'])
/** Engine ids that consume the Deepgram credential for synthesis. */
const DEEPGRAM_TTS_IDS = new Set(['deepgram', 'aura'])
/** Engine ids that consume the xAI credential (Grok). */
const GROK_STT_IDS = new Set(['grok'])
const GROK_TTS_IDS = new Set(['grok'])

/** The setup page body. */
export function VoiceSettings({
  sources,
  actions,
  saveCredential,
  probe,
  probeSts,
  listStsModels,
  listLocalModels,
  listPipelineModels,
  listVoices,
  previewVoice,
  probeConversational,
  listConversationalModels,
  testTts,
  t,
}: VoiceSettingsProps) {
  const voice = useSyncExternalStore(sources.voice.subscribe, sources.voice.getSnapshot)
  const rawConfig = useSyncExternalStore(sources.config.subscribe, sources.config.getSnapshot)
  const config = normalizeVoiceConfig(rawConfig)
  const [keyInput, setKeyInput] = useState('')
  const [customKey, setCustomKey] = useState('')
  const [xaiCredentialInput, setXaiCredentialInput] = useState('')
  const selectedSts = resolveStsSettings(config)
  const [fishKey, setFishKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [quickPicker, setQuickPicker] = useState(false)
  const [picker, setPicker] = useState<'sts' | 'tts' | null>(null)
  const activeMode = config.voiceMode === 'sts' ? 'sts' : 'tts'
  const ttsVoice = pipelineVoice(config)
  const ttsProvider = config.ttsEngine === 'gemini' ? 'gemini' : config.ttsEngine === 'openai' ? 'openai' : config.ttsEngine === 'fish' ? 'fish' : config.ttsEngine === 'kokoro' ? 'kokoro' : config.ttsEngine === 'grok' ? 'xai' : 'deepgram'
  const setTtsVoice = (value: string): void => {
    if (config.ttsEngine === 'gemini') actions.setGeminiTtsVoice(value)
    else if (config.ttsEngine === 'openai') actions.setOpenaiTtsVoice(value)
    else if (config.ttsEngine === 'fish') actions.setFishVoice(value)
    else if (config.ttsEngine === 'kokoro') actions.setLocalTtsVoice(value)
    else if (config.ttsEngine === 'grok') actions.setGrokVoice(value)
    else actions.setDeepgramVoiceModel(value)
  }
  useEffect(() => {
    const provider = config.ttsEngine
    if (provider !== 'openai' && provider !== 'gemini') return
    const model = pipelineModel(config, 'tts')
    if (!model || !(provider === 'openai' ? config.openaiStsCredential : config.geminiStsCredential)) return
    const abort = new AbortController()
    void listVoices({ provider, mode: 'tts', model }, abort.signal).then((catalog) => {
      if (!abort.signal.aborted && !catalog.voices.some(voice => voice.id === ttsVoice)) (provider === 'openai' ? actions.setOpenaiTtsVoice : actions.setGeminiTtsVoice)(catalog.voices[0]?.id ?? '')
    }).catch(() => { /* The voice picker presents discovery failures. */ })
    return () => abort.abort()
  }, [config.ttsEngine, config.openaiTtsModel, config.geminiTtsModel, ttsVoice, config.openaiStsCredential,
    config.geminiStsCredential, listVoices, actions])
  const [localModels, setLocalModels] = useState<LocalVoiceModel[]>([])
  const [localVoiceLabel, setLocalVoiceLabel] = useState('')
  useEffect(() => {
    setLocalVoiceLabel('')
    if ((config.ttsEngine !== 'kokoro' && config.ttsEngine !== 'fish') || !ttsVoice) return
    const abort = new AbortController()
    void listVoices({ provider: ttsProvider, mode: 'tts', model: '' }, abort.signal).then((catalog) => {
      if (!abort.signal.aborted) setLocalVoiceLabel(catalog.voices.find(voice => voice.id === ttsVoice)?.name ?? '')
    }).catch(() => { /* The picker reports catalog failures; the pill retains the selected ID. */ })
    return () => abort.abort()
  }, [config.ttsEngine, ttsVoice, ttsProvider, listVoices])
  const [localError, setLocalError] = useState('')
  useEffect(() => {
    if (!listLocalModels || (config.sttEngine !== 'vosk' && config.ttsEngine !== 'kokoro')) return
    const abort = new AbortController()
    void listLocalModels(abort.signal).then((models) => { if (!abort.signal.aborted) { setLocalModels(models); setLocalError('') } })
      .catch((error: Error) => { if (!abort.signal.aborted) setLocalError(error.message) })
    return () => abort.abort()
  }, [config.sttEngine, config.ttsEngine, listLocalModels])
  const activeVoice = activeMode === 'sts' ? selectedSts.voice : ttsVoice
  const activeProvider = activeMode === 'sts' ? t(`sts.${selectedSts.provider}`)
    : TTS_ENGINES.find(engine => engine.id === config.ttsEngine)?.label ?? config.ttsEngine
  const nativeBackchannels = config.voiceMode === 'sts' && config.stsProvider === 'openai-live'
  const pickerSelection: VoiceSelection = picker === 'sts'
    ? { provider: selectedSts.provider, mode: 'sts', model: selectedSts.model }
    : { provider: ttsProvider, mode: 'tts', model: pipelineModel(config, 'tts') }
  const selectStsVoice = (value: string): void => {
    if (config.stsProvider === 'openai-live') actions.setOpenaiLiveVoice(value)
    else if (config.stsProvider === 'gemini') actions.setGeminiStsVoice(value)
    else if (config.stsProvider === 'openai') actions.setOpenaiStsVoice(value)
    else actions.setStsVoice(value)
  }
  const [stsCredentialInput, setStsCredentialInput] = useState('')
  const [stsModels, setStsModels] = useState<string[]>([])
  const [stsModelsState, setStsModelsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [modelsRefresh, setModelsRefresh] = useState(0)
  useEffect(() => {
    const refresh = (): void => { setModelsRefresh(value => value + 1) }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => {
    const request = new AbortController()
    setStsModels([])
    setStsModelsState(selectedSts.credential === '' ? 'idle' : 'loading')
    if (selectedSts.credential !== '') {
      void listStsModels(request.signal).then((models) => {
        if (request.signal.aborted) return
        const onlyModel = models.length === 1 ? models[0] : undefined
        if (onlyModel !== undefined) {
          if (selectedSts.provider === 'openai-live') actions.setOpenaiLiveModel(onlyModel)
          else if (selectedSts.provider === 'gemini') actions.setGeminiStsModel(onlyModel)
          else if (selectedSts.provider === 'openai') actions.setOpenaiStsModel(onlyModel)
          else actions.setStsModel(onlyModel)
        }
        setStsModels(models)
        setStsModelsState('ready')
      }, () => {
        if (!request.signal.aborted) setStsModelsState('error')
      })
    }
    return () => { request.abort() }
  }, [selectedSts.provider, selectedSts.credential, modelsRefresh, listStsModels, actions])
  const [stsBusy, setStsBusy] = useState(false)
  const [stsResult, setStsResult] = useState<boolean | null>(null)
  const [stsProtocol, setStsProtocol] = useState(false)
  const stsRevision = useRef(0)
  useEffect(() => {
    stsRevision.current += 1
    setStsResult(null)
    return () => { stsRevision.current += 1 }
  }, [selectedSts.provider, selectedSts.credential, selectedSts.model, selectedSts.voice,
    config.stsSilenceSec, config.stsThinking, stsCredentialInput])
  useEffect(() => { setStsCredentialInput('') }, [selectedSts.provider, selectedSts.credential])
  const testSts = async (protocol = false): Promise<void> => {
    setStsProtocol(protocol)
    setStsBusy(true)
    setStsResult(null)
    const revision = stsRevision.current
    try {
      const ready = await probeSts(protocol)
      if (revision === stsRevision.current) setStsResult(ready)
    } catch {
      if (revision === stsRevision.current) setStsResult(false)
    }
    finally { setStsBusy(false) }
  }
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [ttsResult, setTtsResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [convResult, setConvResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [convBusy, setConvBusy] = useState(false)
  const [convCatalog, setConvCatalog] = useState<NonNullable<ConversationalModels['providers']>>([])
  const customPreset = CUSTOM_CONVERSATIONAL_ENDPOINTS.find(item => item.id === config.conversationalCustomProvider)
  const [customModels, setCustomModels] = useState<string[]>([])
  const convModels = config.conversationalProvider === 'custom' ? customModels
    : convCatalog.find(provider => provider.id === config.conversationalProvider)?.models.map(model => model.id) ?? []
  const [convModelsBusy, setConvModelsBusy] = useState(false)
  const [convModelsResult, setConvModelsResult] = useState<{ ok: boolean; text: string } | null>(null)

  // Keep the editable fields in sync when the persisted keys change elsewhere.
  useEffect(() => {
    setKeyInput('')
  }, [config.deepgramCredential])
  useEffect(() => {
    setXaiCredentialInput('')
  }, [config.xaiCredential])

  const [credentialBusy, setCredentialBusy] = useState(false)
  const [credentialError, setCredentialError] = useState(false)
  const saveKey = async (slot: VoiceCredentialSlot, value: string, clear: () => void): Promise<void> => {
    setCredentialBusy(true)
    setCredentialError(false)
    try { await saveCredential(slot, value.trim()); clear() }
    catch { setCredentialError(true) }
    finally { setCredentialBusy(false) }
  }
  const applyKey = (): Promise<void> => saveKey('deepgram', keyInput, () => { setKeyInput('') })
  const applyXaiKey = (): Promise<void> => saveKey('xai', xaiCredentialInput, () => { setXaiCredentialInput('') })

  const sttRevision = useRef(0)
  useEffect(() => {
    sttRevision.current += 1
    setResult(null)
    return () => { sttRevision.current += 1 }
  }, [config.sttEngine, config.localSttModel, config.deepgramCredential, config.xaiCredential,
    config.vadSilenceSec, keyInput, xaiCredentialInput, config.fishCredential, fishKey, config.openaiSttModel,
    config.openaiStsCredential, openaiKey, config.geminiSttModel, config.geminiStsCredential, geminiKey])
  const testStt = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setResult(null)
    const revision = sttRevision.current
    const started = performance.now()
    const timed = (text: string): string => `${text} · ${Math.round(performance.now() - started)}${t('conv.testMs')}`
    try {
      const outcome = await probe()
      if (revision === sttRevision.current) setResult({ ok: outcome.ok, text: timed(outcome.ok ? t('stt.ready') : `${t('stt.failed')}${outcome.message ? `: ${outcome.message}` : ''}`) })
    } catch (error) {
      if (revision === sttRevision.current) setResult({ ok: false, text: timed(`${t('stt.failed')}: ${(error as Error).message}`) })
    } finally { setBusy(false) }
  }

  const testReadBack = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setTtsResult(null)
    const provider = TTS_ENGINES.find(engine => engine.id === config.ttsEngine)?.label ?? config.ttsEngine
    try {
      await testTts()
      setTtsResult({ ok: true, text: `${provider}: ${t('result.ttsOk')}` })
    } catch (e) {
      setTtsResult({ ok: false, text: `${provider}: ${t('result.ttsFail')}: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  const testConversational = async (): Promise<void> => {
    if (convBusy) return
    setConvBusy(true)
    setConvResult(null)
    try {
      const r = await probeConversational()
      const ms = r.ms === undefined ? '' : ` · ${r.ms}${t('conv.testMs')}`
      setConvResult({
        ok: r.ok,
        text: r.ok
          ? `${t('conv.testOk')}${r.model === undefined ? '' : ` · ${r.model}`}${ms}`
          : `${t('conv.testFail')}: ${r.message}${ms}`,
      })
    } catch (e) {
      setConvResult({ ok: false, text: `${t('conv.testFail')}: ${(e as Error).message}` })
    } finally {
      setConvBusy(false)
    }
  }

  const selectCustomUrl = (url: string): void => {
    actions.setConversationalBaseUrl(url)
    actions.setConversationalCredential(false)
    setCustomKey('')
    setCustomModels([])
    setConvModelsResult(null)
    setConvResult(null)
  }
  const selectCustomPreset = (id: string): void => {
    actions.setConversationalCustomProvider(id)
    const preset = CUSTOM_CONVERSATIONAL_ENDPOINTS.find(item => item.id === id)
    selectCustomUrl(preset?.url ?? '')
    actions.setConversationalModel('')
  }
  const selectConvProvider = (id: string): void => {
    actions.setConversationalProvider(id)
    actions.setConversationalModel('')
    setConvResult(null)
  }
  const convCatalogRevision = useRef(0)
  const loadConvModels = async (): Promise<void> => {
    const revision = ++convCatalogRevision.current
    setConvModelsBusy(true)
    setConvResult(null)
    try {
      const result = await listConversationalModels()
      if (revision !== convCatalogRevision.current) return
      setConvCatalog(result.providers ?? [])
      if (config.conversationalProvider === 'custom') setCustomModels(result.models)
      setConvModelsResult(result.ok ? null : { ok: false, text: `${t('conv.modelsFail')}: ${result.message ?? ''}` })
    } catch (error) {
      if (revision !== convCatalogRevision.current) return
      setConvCatalog([])
      setConvModelsResult({ ok: false, text: `${t('conv.modelsFail')}: ${(error as Error).message}` })
    } finally { if (revision === convCatalogRevision.current) setConvModelsBusy(false) }
  }
  useEffect(() => {
    void loadConvModels()
    return () => { convCatalogRevision.current += 1 }
  }, [config.conversationalProvider, config.conversationalBaseUrl, config.conversationalCredential, modelsRefresh])

  const customSource = config.conversationalProvider === 'custom'
  const modelStatus = convResult ?? convModelsResult
  const selectModelSource = (custom: boolean): void => {
    if (custom === customSource) return
    actions.setConversationalSource(custom ? 'custom' : 'harness')
    setConvResult(null)
    setConvModelsResult(null)
    setCustomKey('')
    setCustomModels([])
  }
  const providerOptions: SelectOption[] = [
    { value: '', label: t('conv.chooseProvider') },
    ...convCatalog.map(provider => ({ value: provider.id, label: provider.name })),
  ]
  const sttEngineOptions: SelectOption[] = STT_ENGINES.map(e => ({ value: e.id, label: e.label }))
  const ttsEngineOptions: SelectOption[] = TTS_ENGINES.map(e => ({ value: e.id, label: e.label }))


  const sttUsesDeepgram = DEEPGRAM_STT_IDS.has(config.sttEngine)
  const ttsUsesDeepgram = DEEPGRAM_TTS_IDS.has(config.ttsEngine)
  const sttUsesGrok = GROK_STT_IDS.has(config.sttEngine)
  const ttsUsesGrok = GROK_TTS_IDS.has(config.ttsEngine)
  // Each vendor credential lives once, under whichever engine needs it,
  // preferring recognition when both consume it.
  const dgHome: 'stt' | 'tts' | null = sttUsesDeepgram ? 'stt' : ttsUsesDeepgram ? 'tts' : null
  const xaiHome: 'stt' | 'tts' | null = sttUsesGrok ? 'stt' : ttsUsesGrok ? 'tts' : null

  const dgKeyField = dgHome === null ? null : <CredentialField t={t} id="voice-deepgram-key"
    label={t('key.label')} configured={Boolean(config.deepgramCredential)} value={keyInput}
    placeholder={t('key.placeholder')} onChange={setKeyInput} onApply={applyKey} disabled={busy || credentialBusy} />

  const xaiCredentialField = xaiHome === null ? null : <CredentialField t={t} id="voice-xai-key"
    label={t('settings.xaiCredential')} configured={Boolean(config.xaiCredential)} value={xaiCredentialInput}
    placeholder={t('settings.xaiPlaceholder')} onChange={setXaiCredentialInput} onApply={applyXaiKey} disabled={busy || credentialBusy} />

  const pipelineCredentialField = (provider: 'openai' | 'gemini'): ReactNode => {
    const configured = provider === 'openai' ? config.openaiStsCredential : config.geminiStsCredential
    const value = provider === 'openai' ? openaiKey : geminiKey
    const change = provider === 'openai' ? setOpenaiKey : setGeminiKey
    return <CredentialField t={t} id={`voice-${provider}-pipeline-key`}
      label={t(provider === 'openai' ? 'settings.openaiCredential' : 'settings.geminiCredential')}
      configured={Boolean(configured)} value={value} onChange={change} disabled={credentialBusy || busy}
      onApply={() => saveKey(`${provider}-sts`, value, () => { change(''); setModelsRefresh(value => value + 1) })} />
  }
  const pipelineModels = (provider: 'openai' | 'gemini', kind: 'stt' | 'tts'): ReactNode => <PipelineModelField provider={provider} kind={kind} t={t}
    configured={Boolean(provider === 'openai' ? config.openaiStsCredential : config.geminiStsCredential)}
    refresh={modelsRefresh} discover={listPipelineModels} value={pipelineModel(config, kind)}
    onChange={provider === 'gemini' ? (kind === 'stt' ? actions.setGeminiSttModel : actions.setGeminiTtsModel)
      : (kind === 'stt' ? actions.setOpenaiSttModel : actions.setOpenaiTtsModel)} />
  const fishCredentialField = <CredentialField t={t} id="voice-fish-key" label={t('settings.fishCredential')}
    configured={Boolean(config.fishCredential)} value={fishKey} onChange={setFishKey} disabled={credentialBusy || busy}
    onApply={() => saveKey('fish', fishKey, () => setFishKey(''))} />

  return (
    <div className={css.page}>
      {picker !== null && <VoicePicker key={`${pickerSelection.provider}:${pickerSelection.mode}:${pickerSelection.model}`}
        compact={quickPicker} selection={pickerSelection} selectedVoice={picker === 'sts' ? selectedSts.voice
          : ttsVoice}
        favorites={config.voiceFavorites} onFavorites={actions.setVoiceFavorites}
        listVoices={listVoices} previewVoice={previewVoice} t={t} onClose={() => setPicker(null)}
        onSelect={value => picker === 'sts' ? selectStsVoice(value) : setTtsVoice(value)} />}
      <h2 className={css.heading}>{t('section.heading')}</h2>
      <p className={css.hint}>{t('section.hint')}</p>

      <VoiceCard t={t} title={t('settings.controls')} desc={t('settings.controlsHint')}>
        <SelectField id="voice-response-detail" label={t('settings.responseDetail')} value={config.responseDetail}
          options={[{ value: 'concise', label: t('settings.concise') }, { value: 'detailed', label: t('settings.detailed') }]}
          onChange={value => actions.setResponseDetail(value)} />

        {!(config.voiceMode === 'sts' && config.stsProvider === 'openai-live') && (
          <div className={css.field}>
            <ToggleRow label={t('settings.endConversation')} desc={t('settings.endConversationHint')}
              checked={config.endConversationEnabled}
              onChange={() => { actions.setEndConversationEnabled(!config.endConversationEnabled) }} />
          </div>
        )}

        {(config.voiceMode === 'pipeline' || nativeBackchannels) && (
          <Subsection t={t} title={t('settings.backchannel')}>
            <ToggleRow
              label={t('settings.backchannel')}
              desc={t(nativeBackchannels ? 'settings.backchannelNativeHint' : 'settings.backchannelHint')}
              checked={config.backchannelEnabled}
              onChange={() => { actions.setBackchannelEnabled(!config.backchannelEnabled) }}
            />
            {config.backchannelEnabled && !nativeBackchannels && (
              <>
                <SliderRow
                  label={t('settings.volume')}
                  value={config.backchannelVolume}
                  min={0.1}
                  max={1}
                  step={0.05}
                  format={v => `${Math.round(v * 100)}%`}
                  onChange={v => actions.setBackchannelVolume(round2(v))}
                />
              </>
            )}
          </Subsection>
        )}

        <Subsection t={t} title={t('settings.standby')}>
          <span className={css.hint}>{t('settings.standbyHint')}</span>
          <SliderRow
            label={t('settings.standbyAfter')}
            value={config.voiceStandbySec}
            min={0}
            max={120}
            step={1}
            format={v => `${v}${t('settings.seconds')}`}
            onChange={v => actions.setVoiceStandbySec(Math.round(v))}
          />
        </Subsection>

        <Subsection t={t} title={t('settings.voiceControls')}>
          <SelectField id="voice-control-layout" label={t('layout.label')} value={config.controlLayout ?? 'orb'}
            options={[{ value: 'orb', label: t('layout.orb') }, { value: 'panel', label: t('layout.panel') }]}
            onChange={value => actions.setControlLayout(value)} />

          <div className={css.field}>
            <ToggleRow label={t('settings.audioVisualizer')} desc={t('settings.audioVisualizerHint')}
              checked={config.audioVisualizer} onChange={() => { actions.setAudioVisualizer(!config.audioVisualizer) }} />
          </div>
        </Subsection>
      </VoiceCard>

      {credentialError && <p role="alert">{t('key.hostError')}</p>}
      <VoiceCard t={t} title={t('speech.title')} desc={`${activeProvider} · ${t(activeMode === 'sts' ? 'speech.sts' : 'speech.pipeline')}`}
        quickAction={<SelectedVoiceControl label={activeMode === 'tts' && (config.ttsEngine === 'kokoro' || config.ttsEngine === 'fish') && localVoiceLabel ? localVoiceLabel : activeVoice} key={`${activeMode}:${activeProvider}:${activeVoice}:${selectedSts.model}`}
          selection={activeMode === 'sts' ? { provider: selectedSts.provider, mode: 'sts', model: selectedSts.model }
            : { provider: ttsProvider, mode: 'tts', model: pipelineModel(config, 'tts') }}
          voice={activeVoice} previewVoice={previewVoice} t={t}
          onChoose={() => { setQuickPicker(true); setPicker(activeMode) }} />}>


        <div className={css.field}>
          <span className={css.label}>{t('sts.mode')}</span>
          <div className={css.radioGroup} role="radiogroup" aria-label={t('sts.mode')}>
            <label><input type="radio" name="voice-mode" checked={config.voiceMode === 'pipeline'} onChange={() => actions.setVoiceMode('pipeline')} />{t('sts.pipeline')}</label>
            <label><input type="radio" name="voice-mode" checked={config.voiceMode === 'sts'} onChange={() => actions.setVoiceMode('sts')} />{t('sts.native')}</label>
          </div>
        </div>
        {config.voiceMode === 'sts' ? <>
          <SelectField id="voice-sts-provider" label={t('sts.provider')} value={config.stsProvider}
            options={(['xai', 'gemini', 'openai-live', 'openai'] as const).map(value => ({ value, label: t(`sts.${value}`) }))}
            onChange={value => actions.setStsProvider(value)} />
          <ConnectionSettings t={t}
            indicator={selectedSts.credential ? <span className={css.vadStatusOk} role="img" aria-label={t('key.saved')}>✓</span> : undefined}>
            <CredentialField t={t} id="voice-sts-key" label={t('sts.key')}
              configured={Boolean(selectedSts.credential)} value={stsCredentialInput} onChange={setStsCredentialInput}
              disabled={credentialBusy} onApply={() => saveKey(config.stsProvider === 'openai-live' ? 'openai-sts' : `${config.stsProvider}-sts`, stsCredentialInput, () => { setStsCredentialInput(''); setModelsRefresh(value => value + 1) })} />
          </ConnectionSettings>
          <div className={css.realtimeSelectionRow}>
            <div className={css.realtimeModel}>
              {stsModelsState === 'ready' && stsModels.length > 0 && <div className={css.field}>
                <label className={css.label} htmlFor="voice-sts-model">{t('conv.model')}</label>
                <MenuModel id="voice-sts-model" placeholder={t('sts.chooseModel')}
                  value={stsModels.includes(selectedSts.model) ? selectedSts.model : ''} models={stsModels}
                  onChange={value => config.stsProvider === 'openai-live' ? actions.setOpenaiLiveModel(value) : config.stsProvider === 'gemini' ? actions.setGeminiStsModel(value) : config.stsProvider === 'openai' ? actions.setOpenaiStsModel(value) : actions.setStsModel(value)} />
              </div>}
              {(stsModelsState !== 'ready' || stsModels.length === 0) && <div className={css.btnRow}>
                <span className={css.hint} role="status">{stsModelsState === 'loading' ? t('sts.loadingModels') : stsModelsState === 'error' ? t('conv.modelsFail') : stsModelsState === 'ready' ? t('sts.noModels') : t('key.unset')}</span>
              </div>}
            </div>
            <div className={css.field}>
              <label className={css.label} htmlFor="voice-sts-voice">{t('sts.voice')}</label>
              <button id="voice-sts-voice" type="button" className={css.input}
                onClick={() => { setQuickPicker(false); setPicker('sts') }}>{voiceDisplayName(selectedSts.voice) || t('picker.open')}</button>
            </div>
          </div>
          <div className={css.btnRow}>
            <Button variant="outline" size="sm" disabled={stsBusy || selectedSts.credential === '' || stsCredentialInput.trim() !== ''}
              onClick={() => { void testSts() }}>{stsBusy ? t('conv.checking') : t('sts.test')}</Button>
            <Button variant="outline" size="sm" disabled={stsBusy || selectedSts.credential === '' || stsCredentialInput.trim() !== ''}
              onClick={() => { void testSts(true) }}>{t('sts.protocolTest')}</Button>
            {stsResult !== null && <span className={css.hint}>{stsResult ? (stsProtocol ? t('sts.protocolReady') : t('sts.ready')) : t('sts.failed')}</span>}
          </div>
        </> : <>
          <VoiceCard t={t} title={t('settings.recognitionTitle')}
            desc={[STT_ENGINES.find(engine => engine.id === config.sttEngine)?.label,
              config.sttEngine === 'vosk' ? localModels.find(model => model.id === config.localSttModel)?.name ?? config.localSttModel : ''].filter(Boolean).join(' · ')}>
            <SelectField
              id="voice-stt-engine"
              label={t('settings.recognition')}
              value={config.sttEngine}
              options={sttEngineOptions}
              onChange={v => actions.setSttEngine(v)}
            />
            {config.sttEngine === 'vosk' && <SelectField id="voice-local-stt-model" label={t('local.model')}
              value={config.localSttModel} options={[{ value: '', label: t('local.select') }, ...localModels.filter(model => model.kind === 'stt')
                .map(model => ({ value: model.id, label: `${model.name} (${model.languages.join(', ')})` }))]}
              onChange={value => actions.setLocalSttModel(value)} />}
            {localError && <span role="status" className={css.resultFail}>{localError}</span>}
            {dgHome === 'stt' ? dgKeyField : null}
            {xaiHome === 'stt' ? xaiCredentialField : null}
            {(config.sttEngine === 'openai' || config.sttEngine === 'gemini') && <>{pipelineCredentialField(config.sttEngine)}{pipelineModels(config.sttEngine, 'stt')}</>}
            {config.sttEngine === 'fish' && fishCredentialField}
            {config.sttEngine === 'fish' && <span className={css.hint}>{t('settings.fishBatch')}</span>}
            <div className={css.btnRow}>
              <Button variant="outline" size="sm" onClick={testStt}
                disabled={busy || (config.sttEngine === 'gemini' ? !config.geminiStsCredential || !config.geminiSttModel || geminiKey.trim() !== '' : config.sttEngine === 'openai' ? !config.openaiStsCredential || !config.openaiSttModel || openaiKey.trim() !== '' : config.sttEngine === 'fish' ? !config.fishCredential || fishKey.trim() !== '' : config.sttEngine === 'vosk' ? !config.localSttModel : sttUsesGrok ? config.xaiCredential.trim() === '' || xaiCredentialInput.trim() !== '' : config.deepgramCredential.trim() === '' || keyInput.trim() !== '')}>
                {busy ? t('conv.checking') : t('stt.test')}
              </Button>
              {result !== null && <span role="status" className={`${css.result} ${result.ok ? css.resultOk : css.resultFail}`}>{result.text}</span>}
            </div>
            {!sttUsesDeepgram && !sttUsesGrok && config.sttEngine !== 'fish' && config.sttEngine !== 'openai' && config.sttEngine !== 'gemini' && (
              <span className={css.hint}>{t('settings.onDevice')}</span>
            )}
          </VoiceCard>

          <VoiceCard t={t} title={t('settings.synthesisTitle')}
            desc={[TTS_ENGINES.find(engine => engine.id === config.ttsEngine)?.label,
              voiceDisplayName((config.ttsEngine === 'kokoro' || config.ttsEngine === 'fish') ? localVoiceLabel || ttsVoice : ttsVoice)].filter(Boolean).join(' · ')}>
            <SelectField
              id="voice-tts-engine"
              label={t('settings.synthesis')}
              value={config.ttsEngine}
              options={ttsEngineOptions}
              onChange={v => actions.setTtsEngine(v)}
            />
            {dgHome === 'tts' ? dgKeyField : null}
            {xaiHome === 'tts' ? xaiCredentialField : null}
            {(config.ttsEngine === 'openai' || config.ttsEngine === 'gemini') && <>{config.sttEngine !== config.ttsEngine && pipelineCredentialField(config.ttsEngine)}{pipelineModels(config.ttsEngine, 'tts')}</>}
            {config.ttsEngine === 'fish' && config.sttEngine !== 'fish' && fishCredentialField}
            {dgHome === 'stt' && ttsUsesDeepgram && (
              <span className={css.hint}>{t('settings.deepgramShared')}</span>
            )}
            {xaiHome === 'stt' && ttsUsesGrok && (
              <span className={css.hint}>{t('settings.xaiShared')}</span>
            )}
            {(ttsUsesDeepgram || ttsUsesGrok || config.ttsEngine === 'gemini' || config.ttsEngine === 'openai' || config.ttsEngine === 'fish' || config.ttsEngine === 'kokoro') && <>
              <div className={css.field}>
                <label className={css.label} htmlFor="voice-tts-voice">{t('picker.tts')}</label>
                <div className={css.modelRow}>
                  <input id="voice-tts-voice" className={css.input} value={ttsVoice}
                    spellCheck={false} onChange={event => setTtsVoice(event.target.value)} />
                  <Button size="sm" onClick={() => { setQuickPicker(false); setPicker('tts') }}>{t('picker.open')}</Button>
                </div>
              </div>
            </>}
            <div className={css.btnRow}>
              <Button variant="outline" size="sm" onClick={testReadBack} disabled={busy}>
                {busy ? '…' : t('action.tts')}
              </Button>
              {ttsResult !== null && (
                <span className={`${css.result} ${ttsResult.ok ? css.resultOk : css.resultFail}`}>
                  {ttsResult.text}
                </span>
              )}
            </div>
          </VoiceCard>
          <VoiceCard t={t} title={t('settings.optimization')}
            desc={[customSource ? customPreset?.label ?? t('conv.customSource')
              : convCatalog.find(provider => provider.id === config.conversationalProvider)?.name ?? config.conversationalProvider,
            config.conversationalModel].filter(Boolean).join(' · ')}>
            <div className={css.field}>
              <span className={css.label}>{t('conv.source')}</span>
              <div className={css.radioGroup} role="radiogroup" aria-label={t('conv.source')}>
                <label><input type="radio" name="voice-model-source" checked={!customSource} onChange={() => selectModelSource(false)} />{t('conv.harness')}</label>
                <label><input type="radio" name="voice-model-source" checked={customSource} onChange={() => selectModelSource(true)} />{t('conv.customSource')}</label>
              </div>
            </div>
            {customSource ? <>
              <SelectField id="voice-custom-provider" label={t('conv.provider')}
                value={customPreset?.id ?? 'manual'}
                options={[...CUSTOM_CONVERSATIONAL_ENDPOINTS.map(item => ({ value: item.id, label: item.label })), { value: 'manual', label: t('conv.manual') }]}
                onChange={selectCustomPreset} />
              <ConnectionSettings t={t}
                indicator={config.conversationalCredential ? <span className={css.vadStatusOk} role="img" aria-label={t('key.saved')}>✓</span> : undefined}>
                <TextField id="voice-custom-url" label={t('conv.url')} value={config.conversationalBaseUrl} onChange={selectCustomUrl} />
                <CredentialField t={t} id="voice-custom-key" label={t('conv.key')}
                  configured={Boolean(config.conversationalCredential)} value={customKey}
                  onChange={(value) => { setCustomKey(value); setConvResult(null) }}
                  disabled={credentialBusy || !config.conversationalBaseUrl.trim()}
                  onApply={() => saveKey('conversational', customKey, () => { setCustomKey(''); setModelsRefresh(value => value + 1) })} />
              </ConnectionSettings>
            </> : <>
              <SelectField id="voice-conversational-provider" label={t('conv.provider')}
                value={config.conversationalProvider} options={providerOptions} onChange={selectConvProvider} />
              <span className={css.hint}>{t('conv.hostManaged')}</span>
            </>}
            <div className={css.field}>
              <label className={css.label} htmlFor="voice-conversational-model">{t('conv.model')}</label>
              <div className={css.modelRow}>
                {customSource && !customPreset ? <input id="voice-conversational-model" className={css.input}
                  placeholder={t('settings.exampleModel')} spellCheck={false} value={config.conversationalModel}
                  onChange={(event) => { actions.setConversationalModel(event.target.value); setConvResult(null) }} />
                  : <MenuModel placeholder={t('conv.chooseModel')} id="voice-conversational-model" value={config.conversationalModel}
                    models={convModels} onChange={(m) => { actions.setConversationalModel(m); setConvResult(null) }} />}

              </div>
            </div>
            <div className={css.btnRow}>
              <Button variant="outline" size="sm" onClick={testConversational}
                disabled={convBusy || credentialBusy || !config.conversationalProvider || !config.conversationalModel.trim()
                  || (customSource && (!config.conversationalBaseUrl.trim() || customKey.length > 0))}>
                {convBusy ? '…' : t('conv.test')}
              </Button>
              {(credentialError || convBusy || convModelsBusy || modelStatus) && <span role="status" className={`${css.result} ${credentialError || modelStatus?.ok === false ? css.resultFail : css.resultOk}`}>
                {credentialError ? t('key.hostError') : convBusy ? t('conv.checking') : convModelsBusy ? t('sts.loadingModels') : modelStatus?.text}
              </span>}
            </div>
          </VoiceCard>

          <VoiceCard t={t} title={t('settings.speechDetection')}
            desc={`${t('settings.vadPause')}: ${config.vadSilenceSec.toFixed(1)}${t('settings.seconds')}`}>
            {voice.vadStatus === null ? (
              <span className={css.vadStatus}>{t('vad.checking')}</span>
            ) : voice.vadStatus.engine === 'silero' ? (
              <span className={`${css.vadStatus} ${css.vadStatusOk}`}>{t('vad.silero')}</span>
            ) : (
              <>
                <span className={`${css.vadStatus} ${css.vadStatusWarn}`}>{t('vad.energy')}</span>
                {voice.vadStatus.degradedReason !== null && (
                  <span className={css.vadReason}>{voice.vadStatus.degradedReason}</span>
                )}
              </>
            )}
            <SliderRow
              label={t('settings.vadPause')}
              value={config.vadSilenceSec}
              min={0.5}
              max={5}
              step={0.1}
              format={v => `${v.toFixed(1)}${t('settings.seconds')}`}
              onChange={v => actions.setVadSilenceSec(round1(v))}
            />
          </VoiceCard>

        </>}
      </VoiceCard>



    </div>
  )
}

/** A collapsible sub-group inside a settings card (a drill-down under a group). */
function Subsection({ title, children, t, indicator, summary }: { title: string; children: ReactNode; indicator?: ReactNode; summary?: string } & PropsLocale<'voice'>): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.subsection}>
      <button
        type="button"
        className={css.subsectionHeader}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
        onClick={() => setOpen(!open)}
      >
        <span className={css.subsectionTitle}>{title}</span>
        {summary && <span className={css.subsectionSummary} title={summary}>{summary}</span>}
        {indicator}
        <IconChevronDownOutline14 className={`${css.subsectionChevron}${open ? ` ${css.subsectionChevronOpen}` : ''}`} />
      </button>
      {open ? <div className={css.subsectionBody}>{children}</div> : null}
    </div>
  )
}

/** An expandable settings card (title + description header that discloses its controls). */
function VoiceCard({
  title,
  desc,
  children,
  alwaysOpen = false,
  quickAction,
  t,
}: {
  title: string
  desc: string
  children: ReactNode
  /** Whether the body is always visible (used for read-only status rows). */
  alwaysOpen?: boolean
  quickAction?: ReactNode
} & PropsLocale<'voice'>): JSX.Element {
  const [open, setOpen] = useState(alwaysOpen)
  return (
    <section className={`${css.card}${open ? ` ${css.cardOpen}` : ''}`}>
      <div className={`${css.cardTop}${quickAction === undefined ? '' : ` ${css.cardTopWithVoice}`}`}>
        <button
          type="button"
          className={css.cardHeader}
          aria-expanded={open}
          aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
          onClick={() => setOpen(!open)}
        >
          <span className={css.cardHeadText}>
            <span className={css.cardTitle}>{title}</span>
            <span className={css.cardDesc}>{desc}</span>
          </span>
          <IconChevronDownOutline14 className={`${css.cardChevron}${open ? ` ${css.cardChevronOpen}` : ''}`} />
        </button>
        {quickAction}
      </div>
      {open || alwaysOpen ? <div className={css.cardBody}>{children}</div> : null}
    </section>
  )
}

/** A dropdown as the harness's `Menu` + capsule `.selector`. */
function SelectField<Value extends string>({
  id,
  label,
  value,
  options,
  onChange,
  hint,
}: {
  id: string
  label: string
  value: Value
  options: SelectOption<Value>[]
  onChange: (value: Value) => void
  hint?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const selected = options.find(o => o.value === value)
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={id}>{label}</label>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        items={options.map(o => ({ id: o.value, label: o.label }))}
        selectedId={value}
        onSelect={(id) => { setOpen(false); onChange(id as Value) }}
        anchor={(
          <button
            type="button"
            id={id}
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
          >
            <span>{selected?.label ?? value}</span>
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
      {hint !== undefined ? <span className={css.hint}>{hint}</span> : null}
    </div>
  )
}

/** Discovered provider model IDs offered through the shared dropdown. */
function MenuModel({ placeholder, id, value, models, onChange }: {
  id: string
  value: string
  placeholder: string
  models: readonly string[]
  onChange: (model: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const choices = value && !models.includes(value) ? [value, ...models] : models
  return <Menu open={open} onClose={() => setOpen(false)}
    items={choices.map(model => ({ id: model, label: model }))}
    selectedId={value || undefined}
    onSelect={(model) => { setOpen(false); onChange(model) }}
    anchor={<button type="button" id={id} className={css.selector}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span>{value || placeholder}</span><IconChevronDownOutline14 className={css.chevron} />
    </button>} />
}

/** A single-line settings text field (label over a full-width ink). */
function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hint?: string
}): JSX.Element {
  return (
    <div className={css.field}>
      <label className={css.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        className={css.input}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        autoComplete={type === 'password' ? 'off' : undefined}
        spellCheck={false}
      />
      {hint !== undefined ? <span className={css.hint}>{hint}</span> : null}
    </div>
  )
}

/** A single labeled toggle row (Subagent `.switch` pill on the right). */
function ToggleRow({
  label,
  desc,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  desc?: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className={css.toggleRow}>
      <div className={css.toggleText}>
        <div className={css.toggleLabel}>{label}</div>
        {desc !== undefined ? <div className={css.toggleDesc}>{desc}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        className={`${css.switch}${checked ? ` ${css.switchOn}` : ''}`}
        disabled={disabled}
        onClick={onChange}
      >
        <span className={css.thumb} />
      </button>
    </div>
  )
}

/** A labeled numeric slider row. */
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className={css.sliderRow}>
      <div className={css.sliderHead}>
        <span className={css.sliderLabel}>{label}</span>
        <span className={css.sliderValue}>{format(value)}</span>
      </div>
      <input
        className={css.slider}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Model discovery follows saved credential changes; an empty selection adopts the first accessible model. */
function PipelineModelField({ provider, kind, t, configured, refresh, discover, value, onChange }: PropsLocale<'voice'> & {
  provider: 'openai' | 'gemini'
  kind: 'stt' | 'tts'
  configured: boolean
  refresh: number
  discover: VoiceSettingsInjected['listPipelineModels']
  value: string
  onChange: (model: string) => void
}): ReactNode {
  const [models, setModels] = useState<string[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const abort = new AbortController()
    setModels([])
    if (!configured || !discover) { setState('ready'); return () => abort.abort() }
    setState('loading')
    void discover(provider, kind, abort.signal).then((ids) => {
      if (abort.signal.aborted) return
      setModels(ids); setState('ready')
    }).catch(() => { if (!abort.signal.aborted) setState('error') })
    return () => abort.abort()
  }, [configured, discover, provider, kind, refresh])
  useEffect(() => { if (state === 'ready' && configured && !models.includes(value) && models[0]) onChange(models[0]) }, [models, value, onChange, state, configured])
  return <>
    <SelectField id={`voice-${provider}-${kind}-model`} label={t('conv.model')} value={value}
      options={[{ value: '', label: t(state === 'loading' ? 'sts.loadingModels' : 'sts.chooseModel') }, ...models.map(id => ({ value: id, label: id }))]}
      onChange={onChange} />
    {state === 'error' && <span role="status" className={css.resultFail}>{t('conv.modelsFail')}</span>}
    {state === 'ready' && configured && models.length === 0 && <span role="status" className={css.resultFail}>{t('settings.noSpeechModels')}</span>}
  </>
}
