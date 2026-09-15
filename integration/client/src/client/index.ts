import { AudioVisualizer } from './AudioVisualizer.tsx'
import { cacheVoicePreviews } from './voice-preview-cache.ts'
import { streamVoicePreview } from './voice-preview-stream.ts'
import { pipelineVoice } from './config.ts'
import { takeLegacyVoiceCredentials, type VoiceCredentialSlot } from './voice-credentials.ts'
import { VoiceDispatchMessage } from './VoiceDispatchMessage.tsx'
import { parseVoiceCatalog } from './voice-catalog.ts'
/**
 * Voice surface plugin, browser half: a mic orb in the conversation.input.dock
 * strip plus a Voice settings page, both driven by the voice loop.
 *
 * The loop (mic → STT → session → reply → TTS) is wired here once and shared
 * by both faces through two reactive stores: the live runtime state and the
 * persisted config. The dock is a thin state-driven orb; the setup page owns
 * the durable configuration (Deepgram key, toggles) and the diagnostics.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the Session Controller service used for session identity.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the Conversation service and input-dock slot.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned slots service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the settings slot declarations (settings.section) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { resolveStsSettings } from './sts-settings.ts'
import { voiceTranscriptDefinition } from './voice-transcript.ts'
import { VoiceTranscriptNodeView } from './VoiceTranscriptNodeView.tsx'
import { MicDock, PanelVoiceControl } from './MicDock.tsx'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { VoiceSettingsIcon } from './VoiceSettingsIcon.tsx'
import { VoiceSettings } from './VoiceSettings.tsx'
import { attachVoiceLoop, STT_ROUTE, STT_STREAM_ROUTE, STT_WS_ROUTE, TTS_ROUTE, HEALTH_ROUTE } from './dsh-transport.ts'
import { SileroVad } from './silero-vad.ts'
import { READ_BACK_TEST } from './VoiceSettings.tsx'
import { createVoiceConfigHandle, normalizeVoiceConfig } from './config.ts'
import { createVoiceRuntimeStore } from './state.ts'
import type { MicDockActions } from './slots.ts'
import type { VoiceSettingsInjected } from './VoiceSettings.tsx'
import { en, zh, type VoiceKey } from './locales.ts'
import { createStsController } from './sts-controller.ts'
import { createVoiceLifecycle } from './voice-lifecycle.ts'
import { createVoiceControls } from './voice-controls.ts'
import { createStatusSounds } from './status-sounds.ts'

export { MicDock } from './MicDock.tsx'
export { VoiceSettings } from './VoiceSettings.tsx'
export type { MicDockActions } from './slots.ts'
export type { VoiceSettingsInjected } from './VoiceSettings.tsx'
export type { VoiceKey } from './locales.ts'
export { createVoiceConfigHandle } from './config.ts'
export { createVoiceRuntimeStore, phaseColor, phaseLabel } from './state.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The voice dock + setup page copy. */
    voice: VoiceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'voice'

export const inject = ['slots', 'locale', 'remote', 'sessions']

/**
 * Client plugin body: the mic orb + the Voice setup page, wired to one loop.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'voice-client: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['uiConversation'], (scope) => {
    scope.slots.inject('conversation.chat.node', () => [
      scope.uiConversation.events.register(voiceTranscriptDefinition),
      scope.slots.register({ name: 'conversation.chat.node', key: 'voice-transcript', locale: NS }, VoiceTranscriptNodeView),
    ])
  })

  // Durable config (persisted) + the live loop state, shared by both faces.
  const legacyCredentials = takeLegacyVoiceCredentials()
  const configHandle = createVoiceConfigHandle()
  const config = configHandle.create()
  const voice = createVoiceRuntimeStore()
  const credentialActions = {
    deepgram: config.actions.setDeepgramCredential,
    xai: config.actions.setXaiCredential,
    fish: config.actions.setFishCredential,
    'xai-sts': config.actions.setStsCredential,
    'gemini-sts': config.actions.setGeminiStsCredential,
    'openai-sts': config.actions.setOpenaiStsCredential,
    conversational: config.actions.setConversationalCredential,
  }
  const credentialRequest = async (
    endpoint: string, slot: VoiceCredentialSlot, value?: string, migrate = false, baseUrl = config.getSnapshot().conversationalBaseUrl,
  ): Promise<void> => {
    const connection = ctx.get('connection')
    if (!connection) throw new Error('Voice connection unavailable')
    const result = await connection.rpc.call('/voice-credentials', endpoint, {
      slot, ...(slot === 'conversational' ? { baseUrl } : {}),
      ...(value === undefined ? {} : { value, migrate }),
    })
    if (!result.ok || typeof result.value !== 'object' || result.value === null || !('configured' in result.value) || typeof result.value.configured !== 'boolean') throw new Error('Voice credential setup failed')
    if (slot !== 'conversational' || baseUrl === config.getSnapshot().conversationalBaseUrl) credentialActions[slot](result.value.configured)
    if (endpoint === 'save' && !migrate) {
      for (const entry of [...legacyCredentials]) {
        if (entry.slot !== slot || (slot === 'conversational' && entry.baseUrl !== baseUrl)) continue
        entry.value = ''
        legacyCredentials.splice(legacyCredentials.indexOf(entry), 1)
      }
      if (legacyCredentials.length === 0 && voice.getSnapshot().error === t('key.hostError')) voice.setError(null)
    }
  }
  ctx.inject(['connection'], (connected) => {
    let disposed = false
    connected.effect(() => () => { disposed = true }, 'voice-client: credential status lifetime')
    const sync = async (): Promise<void> => {
      let migrationFailed = false
      for (const entry of [...legacyCredentials]) {
        if (disposed) return
        try {
          await credentialRequest('save', entry.slot, entry.value, true, entry.baseUrl)
          entry.value = ''
          const index = legacyCredentials.indexOf(entry)
          if (index >= 0) legacyCredentials.splice(index, 1)
        } catch { migrationFailed = true }
      }
      for (const slot of Object.keys(credentialActions) as VoiceCredentialSlot[]) {
        if (disposed) return
        if (slot === 'conversational' && (config.getSnapshot().conversationalProvider !== 'custom' || !config.getSnapshot().conversationalBaseUrl)) continue
        await credentialRequest('status', slot)
      }
      if (migrationFailed && !disposed) voice.setError(t('key.hostError'))
    }
    void sync().catch(() => { if (!disposed) voice.setError(t('key.hostError')) })
    let customEndpoint = ''
    connected.effect(() => config.subscribe(() => {
      const current = config.getSnapshot()
      const endpoint = current.conversationalProvider === 'custom' ? current.conversationalBaseUrl : ''
      if (endpoint === customEndpoint) return
      customEndpoint = endpoint
      if (endpoint) void credentialRequest('status', 'conversational', undefined, false, endpoint).catch(() => { /* Incomplete edited URLs have no saved credential status. */ })
    }), 'voice-client: custom credential status')


  })

  ctx.slots.inject('conversation.chat.node', () => (['user', 'steering'] as const).map(key => ctx.slots.register({
    name: 'conversation.chat.node', key, priority: -10, locale: 'chat',
    inject: () => ({ voiceSettings: { getSnapshot: config.getSnapshot, subscribe: config.subscribe } }),
  }, VoiceDispatchMessage)))

  // `cfg` always normalizes the snapshot: the store rehydrates persisted config
  // with a full replace, so legacy configs can yield `undefined` for newer knobs.
  const cfg = () => normalizeVoiceConfig(config.getSnapshot())
  const sounds = createStatusSounds()
  const lifecycle = createVoiceLifecycle(voice, cfg, sounds)

  // One loop transports STT through the host route, prompts the session, and
  // speaks replies. Mute/read-back are read live from the config each chunk,
  // always through the normalized `cfg` (see above).
  const controller = attachVoiceLoop(ctx, {
    isMuted: () => cfg().muted,
    isReadBack: () => cfg().readBack,
    // The TTS voice model is per-engine: Deepgram uses the Flux voice, Grok uses
    // its own voice catalog.
    getVoice: () => pipelineVoice(cfg()),
    getSttEngine: () => cfg().sttEngine,
    getTtsEngine: () => cfg().ttsEngine,
    getConfig: () => cfg(),
    sttRoute: STT_ROUTE,
    sttStreamRoute: STT_STREAM_ROUTE,
    sttWsRoute: STT_WS_ROUTE,
    ttsRoute: TTS_ROUTE,
    healthRoute: HEALTH_ROUTE,
  }, voice, {
    lifecycle,
    // Provider-agnostic neural VAD (Silero) in the browser: decides speech
    // onset/offset and barge-in by speech content, not energy, so ambient noise
    // and the (uncancelled) reply do not produce spurious phantom messages or
    // misfired barge-ins. Echo cancellation, when added, feeds the SAME VAD a
    // reference-cancelled signal — this seam does not change. The model loads
    // lazily on the first feed. Diagnostics go through the harness logger so a
    // wasm-load failure (or the energy-VAD degrade) is visible in the harness,
    // and the status is pushed into the runtime store so the Voice settings page
    // can surface "speech detection degraded" in-product.
    vad: hangoverMs => new SileroVad({
      silenceMs: hangoverMs,
      logger: ctx.logger,
      onVadStatus: status => voice.setVadStatus(status),
    }),
  })
  const sts = createStsController(cfg, voice, t('sts.failed'), (sessionId, notify) => {
    const source = ctx.sessions.binding(sessionId)?.eventSource
    if (source === undefined) return () => {}
    let latest = 0
    const scan = (): number | undefined => {
      let completed: number | undefined
      for (const entry of source.getSnapshot().entries) {
        if (entry.type !== 'event' || entry.event.seq <= latest) continue
        latest = entry.event.seq
        if (entry.event.type === 'turn/end') completed = entry.event.data.turn
      }
      return completed
    }
    scan()
    return source.subscribe(() => { const turn = scan(); if (turn !== undefined) notify(turn) })
  }, t('sts.transcriptionFailed'), lifecycle, t('sts.commandFailed'), ctx.sessions)
  const controls = createVoiceControls(() => cfg().voiceMode === 'sts' ? sts : controller)
  ctx.effect(() => () => {
    const stopped = controls.stop()
    sounds.dispose()
    return stopped
  }, 'voice-client: audio teardown')
  let selectedMode = `${cfg().voiceMode}:${cfg().stsProvider}`
  ctx.effect(() => config.subscribe(() => {
    const mode = `${cfg().voiceMode}:${cfg().stsProvider}`
    if (mode === selectedMode) { sts.settingsChanged(); controller.loop.settingsChanged(); return }
    selectedMode = mode
    void controls.stop()
  }), 'voice-client: mode changes')

  const panelSupport = createSnapshotStore(false)
  const voiceActions = (sessionId: SessionId): MicDockActions => ({
    onToggle: (id: SessionId) => {
      if (cfg().voiceMode !== 'sts' && (!cfg().conversationalProvider.trim() || !cfg().conversationalModel.trim())) {
        voice.setError(t('conv.required'))
        voice.setPhase('error')
        return Promise.resolve()
      }
      return controls.start(id).catch((e) => {
        voice.setError((e as Error).message)
        voice.setPhase('error')
      })
    },
    onStop: () => {
      void controls.stop()
    },
    onMute: () => {
      config.actions.setMuted(!config.getSnapshot().muted)
    },
    onReadBack: () => {
      // Speak the last agent output through the normal conversational route.
      // `readBackOutput` recovers it from the persisted session, so it also
      // works after a page reload (when the in-memory `lastReply` is gone).
      void controls.readBackOutput(sessionId).catch((e) => {
        voice.setError((e as Error).message)
      })
    },
    sources: {
      panelSupport,
      voice,
      // config is a StoreInstance: getSnapshot/subscribe satisfy ObservableSnapshot.
      config: { getSnapshot: config.getSnapshot, subscribe: config.subscribe },
    },
  })
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'voice-visualizer', order: 30, locale: NS, inject: voiceActions,
  }, AudioVisualizer))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'voice', order: 30, locale: NS, inject: voiceActions,
  }, MicDock))
  ctx.slots.inject('conversation.input.emptyAction', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.input.emptyAction', priority: 30, locale: NS, inject: voiceActions,
    }, PanelVoiceControl)
    panelSupport.set(true)
    return () => { dispose(); panelSupport.set(false) }
  })

  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', id: 'voice',
  }, VoiceSettingsIcon))

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'voice',
    order: 20,
    label: () => t('nav.title'),
    locale: NS,
    inject: (): VoiceSettingsInjected => ({
      sources: {
        voice,
        config: { getSnapshot: config.getSnapshot, subscribe: config.subscribe },
      },
      actions: config.actions,
      saveCredential: (slot, value) => credentialRequest('save', slot, value),
      probe: () => controller.probe(),
      probeSts: async (protocol = false) => {
        const c = cfg()
        const selected = resolveStsSettings(c)
        const connection = ctx.get('connection')
        if (connection === undefined) return false
        const result = await connection.rpc.call('/voice-sts', 'probe', {
          provider: selected.provider, model: selected.model, voice: selected.voice,
          silenceSec: c.stsSilenceSec, thinking: c.stsThinking, protocol,
        })
        return result.ok && typeof result.value === 'object' && result.value !== null
          && 'ready' in result.value && result.value.ready === true
      },
      listPipelineModels: async (provider, kind, signal) => {
        const connection = ctx.get('connection')
        if (!connection) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-sts', 'pipeline-models', { provider, kind }, signal)
        if (!result.ok || typeof result.value !== 'object' || result.value === null || !('models' in result.value)
          || !Array.isArray(result.value.models) || !result.value.models.every((id: unknown): id is string => typeof id === 'string')) throw new Error('Speech model discovery failed')
        return result.value.models
      },
      listStsModels: async (signal) => {
        const selected = resolveStsSettings(cfg())
        const connection = ctx.get('connection')
        if (connection === undefined) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-sts', 'models', { provider: selected.provider }, signal)
        if (!result.ok || typeof result.value !== 'object' || result.value === null
          || !('models' in result.value) || !Array.isArray(result.value.models)
          || !result.value.models.every((model: unknown): model is string => typeof model === 'string')) throw new Error('STS model discovery failed')
        return result.value.models
      },
      listLocalModels: async (signal) => {
        const connection = ctx.get('connection')
        if (!connection) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-local', 'models', {}, signal)
        if (!result.ok || !Array.isArray(result.value)) throw new Error('Local model discovery failed')
        return result.value.map((item: unknown) => {
          if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string'
            || !('name' in item) || typeof item.name !== 'string' || !('kind' in item) || (item.kind !== 'stt' && item.kind !== 'tts')
            || !('languages' in item) || !Array.isArray(item.languages) || !item.languages.every((v: unknown) => typeof v === 'string')) {
            throw new Error('Invalid local model metadata')
          }
          return { id: item.id, name: item.name, kind: item.kind, languages: item.languages as string[] }
        })
      },
      listVoices: async (selection, signal) => {
        const connection = ctx.get('connection')
        if (connection === undefined) throw new Error('Voice connection unavailable')
        const language = selection.provider === 'fish'
          ? selection.language ?? new Intl.Locale(ctx.locale.getSnapshot().active).language : undefined
        const result = await connection.rpc.call('/voice-sts', 'voices', {
          ...selection, ...(language === undefined ? {} : { language }),
        }, signal)
        if (!result.ok) throw new Error('Voice discovery failed')
        return { ...parseVoiceCatalog(result.value), ...(language === undefined ? {} : { filterLanguage: language }) }
      },
      previewVoice: cacheVoicePreviews(streamVoicePreview),
      probeConversational: () => controller.probeConversational(),
      listConversationalModels: () => controller.listConversationalModels(),
      testTts: () => {
        voice.setPhase('speaking')
        return controller.testTts(READ_BACK_TEST).finally(() => {
          voice.setPhase('idle')
        })
      },
    }),
  }, VoiceSettings))
}
