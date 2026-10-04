import { VoiceQuickControls } from './VoiceQuickControls.tsx'
import { cacheVoicePreviews } from './voice-preview-cache.ts'
import { streamVoicePreview } from './voice-preview-stream.ts'
import { pipelineVoice } from './config.ts'
import { takeLegacyVoiceCredentials, type VoiceCredentialSlot } from './voice-credentials.ts'
import { parseLocalModels, parseVoiceCatalog } from './voice-catalog.ts'
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
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
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
// Type-only: pulls the bundle configuration and activation slots into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { resolveStsSettings } from './sts-settings.ts'
import { parseStsModelListing, type StsModelListing } from './sts-model.ts'
import { voiceTranscriptDefinition } from './voice-transcript.ts'
import { VoiceTranscriptNodeView } from './VoiceTranscriptNodeView.tsx'
import { MicDockOverlay, VoiceSessionGuard } from './MicDock.tsx'
import { VoiceOrb } from './VoiceOrb.tsx'
import { VoiceSettings } from './VoiceSettings.tsx'
import { VoiceSetupPrompt } from './VoiceSetupPrompt.tsx'
import { attachVoiceLoop, STT_ROUTE, STT_STREAM_ROUTE, STT_WS_ROUTE, TTS_ROUTE, HEALTH_ROUTE } from './dsh-transport.ts'
import { SileroVad } from './silero-vad.ts'
import { READ_BACK_TEST } from './VoiceSettings.tsx'
import { clearVoiceCredentialStatuses, createVoiceConfigHandle, normalizeVoiceConfig, type VoiceConfig } from './config.ts'
import { createVoiceRuntimeStore } from './state.ts'
import type { MicDockActions } from './slots.ts'
import type { VoiceSettingsInjected } from './VoiceSettings.tsx'
import type { VoiceSetupPromptInjected } from './VoiceSetupPrompt.tsx'
import { en, zh, type VoiceKey } from './locales.ts'
import { createStsController } from './sts-controller.ts'
import type { StsFailure } from '@voicemesh/composer/browser'
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

/**
 * Word one realtime failure. The host names its own endings with an application close code, so a
 * replaced connection or a finished session is reported as itself instead of as a credential
 * problem; every other failure keeps the settings reminder.
 * @param t - locale lookup for this plugin's dictionary.
 * @param failure - reason and bounded detail reported by the controller.
 * @returns the message shown in the dock.
 */
export function realtimeFailureText(t: (key: VoiceKey) => string, failure: StsFailure): string {
  const code = failure.detail === undefined ? failure.reason : `${failure.reason}: ${failure.detail}`
  if (failure.reason === 'socket-closed') {
    if (code.includes('4001')) return `${t('sts.superseded')} [${code}]`
    if (code.includes('4000')) return `${t('sts.ended')} [${code}]`
    if (code.includes('4002')) return `${t('sts.notStarted')} [${code}]`
  }
  return `${t('sts.failed')} [${code}]`
}

/** The transport one session runs on: changing either half needs a new connection. */
export function stsTransportKey(config: Pick<VoiceConfig, 'voiceMode' | 'stsProvider'>): string {
  return `${config.voiceMode}:${config.stsProvider}`
}

/**
 * What one settings change does to a session that is already live.
 *
 * Only a different transport ends the session, because only a different transport cannot be served
 * over the connection already open. Every other preference — the thinking level, the silence
 * window, response detail, the flags — is read out of the start payload when a session begins, so
 * the change lands on the next session and the live one keeps running. Somebody who changes an
 * option while voice is on is not asking to be hung up on, and they are not asking for the
 * microphone to be released and reacquired either.
 * @param previous - transport key the live session was started under.
 * @param config - settings as they stand after the change.
 * @returns 'stop' when the live session must end, 'refresh' when it can absorb the change.
 */
export function settingsChangeEffect(previous: string, config: Pick<VoiceConfig, 'voiceMode' | 'stsProvider'>): 'stop' | 'refresh' {
  return stsTransportKey(config) === previous ? 'refresh' : 'stop'
}

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
  let credentialStatusReady = false
  const credentialStatusListeners = new Set<() => void>()
  const credentialStatus = {
    getSnapshot: (): boolean => credentialStatusReady,
    subscribe: (listener: () => void): (() => void) => {
      credentialStatusListeners.add(listener)
      return () => credentialStatusListeners.delete(listener)
    },
  }
  const completeCredentialStatusScan = (): void => {
    if (credentialStatusReady) return
    credentialStatusReady = true
    for (const listener of credentialStatusListeners) listener()
  }
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
  // The renderer store outlives a profile home. A prior profile's persisted markers are not
  // credential facts for this host, so wait for the authenticated status reads below.
  clearVoiceCredentialStatuses(config.actions)
  const credentialRequest = async (
    endpoint: string, slot: VoiceCredentialSlot, value?: string, migrate = false, baseUrl = config.getSnapshot().conversationalBaseUrl,
  ): Promise<void> => {
    const connection = ctx.get('connection') as ConnectionHandle | undefined
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
    void sync().catch(() => { if (!disposed) voice.setError(t('key.hostError')) }).finally(() => {
      if (!disposed) completeCredentialStatusScan()
    })
    let customEndpoint = ''
    connected.effect(() => config.subscribe(() => {
      const current = config.getSnapshot()
      const endpoint = current.conversationalProvider === 'custom' ? current.conversationalBaseUrl : ''
      if (endpoint === customEndpoint) return
      customEndpoint = endpoint
      if (endpoint) void credentialRequest('status', 'conversational', undefined, false, endpoint).catch(() => { /* Incomplete edited URLs have no saved credential status. */ })
    }), 'voice-client: custom credential status')


  })

  // The host's voice-to-coding prompts remain in the Session log for the coding agent.

  // `cfg` always normalizes the snapshot: the store rehydrates persisted config
  // with a full replace, so legacy configs can yield `undefined` for newer knobs.
  const cfg = () => normalizeVoiceConfig(config.getSnapshot())
  const sounds = createStatusSounds()
  const lifecycle = createVoiceLifecycle(voice, cfg, sounds)

  // One loop transports STT through the host route, prompts the session, and
  // speaks replies. Mute/read-back are read live from the config each chunk,
  // always through the normalized `cfg` (see above).
  // Set from the last dock render; the wake phrase activates exactly what the button would.
  let wakeSessionId: SessionId | undefined
  const controller = attachVoiceLoop(ctx, {
    isMuted: () => cfg().muted,
    isReadBack: () => cfg().readBack,
    // The TTS voice model is per-engine: Deepgram uses the Flux voice, Grok uses
    // its own voice catalog.
    getVoice: () => pipelineVoice(cfg()),
    getSttEngine: () => cfg().sttEngine,
    getTtsEngine: () => cfg().ttsEngine,
    getConfig: () => cfg(),
    // The wake phrase presses the same button the dock does. Late-bound because that action is
    // defined below this call.
    onWakePhrase: () => wakeActions(),
    onWakeFailure: message => voice.setError(message),
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
  /**
   * Compose the realtime failure with the step that failed, so a report names
   * itself instead of repeating one generic sentence. The step vocabulary comes
   * from Composer; the wording stays the application's. The same line goes to
   * the browser console for a debug session.
   */
  const stsFailureText = (failure: StsFailure): string => {
    const code = failure.detail === undefined ? failure.reason : `${failure.reason}: ${failure.detail}`
    console.warn('[voice] realtime session failed', code)
    return realtimeFailureText(t, failure)
  }
  const sts = createStsController(cfg, voice, stsFailureText, (sessionId, notify) => {
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
    return source.subscribe(() => {
      const turn = scan()
      if (turn !== undefined) notify(turn)
    })
  }, t('sts.transcriptionFailed'), lifecycle, t('sts.commandFailed'), ctx.sessions, t('sts.chooseModel'))
  const controls = createVoiceControls(() => cfg().voiceMode === 'sts' ? sts : controller)
  ctx.effect(() => () => {
    const stopped = controls.stop()
    sounds.dispose()
    return stopped
  }, 'voice-client: audio teardown')
  // The inactivity deadline means different things per turn, and the shared
  // lifecycle is the only thing that can time it: it arms the deadline from real
  // speech activity, which a client-side copy of the timer cannot see (a long
  // sentence stays in the listening phase and would look idle). Parking is
  // therefore left entirely to the deadline, and the client does not react to it
  // by stopping: standby releases the microphone and the provider leg while the
  // voice session waits for the next activation, so an owed answer or a running
  // job is waited out instead of cancelled.
  // Where the wait goes: the press starts the browser's own preparation
  // (microphone capture, SDP offer) before anything reaches the harness, so the
  // phases are timed here and reported with the host's own startup stages.
  let connectStartedAt: number | undefined
  ctx.effect(() => {
    let previous = voice.getSnapshot().phase
    return voice.subscribe(() => {
      const phase = voice.getSnapshot().phase
      if (phase === previous) return
      const from = previous
      previous = phase
      if (connectStartedAt === undefined || phase === 'connecting') return
      if (phase !== 'listening' && phase !== 'standby' && phase !== 'error') return
      ctx.logger.info('STS client timing:', {
        stage: `press-to-${phase}`, from, elapsedMs: Math.round(performance.now() - connectStartedAt),
      })
      connectStartedAt = undefined
    })
  }, 'voice-client: connect timing')
  let selectedTransport = stsTransportKey(cfg())
  ctx.effect(() => config.subscribe(() => {
    controller.refreshWake()
    // Everything a running session cannot absorb is settled here, once: a settings change that
    // keeps the same transport refreshes the live connection (transcript history, timing) and
    // leaves it open, and only a transport switch ends it.
    if (settingsChangeEffect(selectedTransport, cfg()) === 'refresh') {
      sts.settingsChanged()
      controller.loop.settingsChanged()
      return
    }
    selectedTransport = stsTransportKey(cfg())
    void controls.stop()
  }), 'voice-client: transport changes')

  /**
   * Discover the selected provider's realtime models, each with the thinking states it acts on.
   *
   * One implementation for both faces that need the catalog: the settings screen offers the level
   * choice from it, and the composer's tip names the level only for a model the catalog says
   * honours one.
   * @param signal - aborts the host round trip.
   * @returns the discovered listings.
   */
  const discoverStsModels = async (signal: AbortSignal): Promise<readonly StsModelListing[]> => {
    const selected = resolveStsSettings(cfg())
    const connection = ctx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error('Voice connection unavailable')
    const result = await connection.rpc.call('/voice-sts', 'models', { provider: selected.provider }, signal)
    // Each listing carries the thinking states the model offers, so a panel can offer that choice
    // only where it changes the session. An entry this build cannot read as a listing fails the
    // call; a thinking pair it cannot read only costs the choice itself.
    if (!result.ok || typeof result.value !== 'object' || result.value === null
      || !('models' in result.value) || !Array.isArray(result.value.models)) throw new Error('STS model discovery failed')
    const listings: StsModelListing[] = []
    for (const entry of result.value.models) {
      const listing = parseStsModelListing(entry)
      if (listing === null) throw new Error('STS model discovery failed')
      listings.push(listing)
    }
    return listings
  }
  // The wake phrase is a second way to press the microphone button: it invokes exactly the action
  // below, for the session the dock was last rendered for. Nothing here reimplements activation —
  // the app's own guard, session handling and error reporting all apply unchanged.
  const wakeActions = (): void | Promise<void> => {
    if (wakeSessionId === undefined) return
    return voiceActions(wakeSessionId).onToggle(wakeSessionId)
  }
  const voiceActions = (sessionId: SessionId): MicDockActions => {
    // Remembered so the wake phrase can act on the session the dock is showing.
    wakeSessionId = sessionId
    return {
    onToggle: (id: SessionId) => {
      if (cfg().voiceMode !== 'sts' && (!cfg().conversationalProvider.trim() || !cfg().conversationalModel.trim())) {
        voice.setError(t('conv.required'))
        voice.setPhase('error')
        return Promise.resolve()
      }
      // A failure's message belongs to the attempt that reported it; this attempt replaces it, so the
      // dock stops showing the previous ending the moment a new session is asked for.
      voice.setError(null)
      connectStartedAt = performance.now()
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
    onSpeakerMute: () => {
      config.actions.setSpeakerMuted(!config.getSnapshot().speakerMuted)
    },
    listStsModels: discoverStsModels,
    onReadBack: () => {
      // Speak the last agent output through the normal conversational route.
      // `readBackOutput` recovers it from the persisted session, so it also
      // works after a page reload (when the in-memory `lastReply` is gone).
      void controls.readBackOutput(sessionId).catch((e) => {
        voice.setError((e as Error).message)
      })
    },
    sources: {
      voice,
      // config is a StoreInstance: getSnapshot/subscribe satisfy ObservableSnapshot.
      config: { getSnapshot: config.getSnapshot, subscribe: config.subscribe },
    },
    }
  }
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right', id: 'voice-quick-controls', order: 30, locale: NS, inject: voiceActions,
  }, VoiceQuickControls))
  // The control itself sits in the composer's empty-draft seat (the Send
  // position); the headless guard keeps a session's voice from outliving the
  // session, since the control unmounts as soon as the draft is non-empty.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'voice-session-guard', order: 30, locale: NS, inject: voiceActions,
  }, VoiceSessionGuard))
  // The supported overlay anchor is inside the composer card. MicDockOverlay only covers the current
  // empty-draft Send action when it can identify it, and otherwise leaves the Harness action alone.
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'voice-mic-dock', order: 30, locale: NS, inject: voiceActions,
  }, MicDockOverlay))
  // The assistant-output cloud occupies the full-width dock above the composer.
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'voice-assistant-orb', order: 20, locale: NS, inject: voiceActions,
  }, VoiceOrb))
  /** Reuse the existing settings page's actions and observable sources in both Plugin slots. */
  const settingsInjected = (): VoiceSettingsInjected => ({
      sources: {
        voice,
        config: { getSnapshot: config.getSnapshot, subscribe: config.subscribe },
        locale: {
          getSnapshot: () => ctx.locale.getSnapshot(),
          subscribe: listener => ctx.locale.subscribe(listener),
        },
      },
      actions: config.actions,
      saveCredential: (slot, value) => credentialRequest('save', slot, value),
      probe: () => controller.probe(),
      probeSts: async (protocol = false) => {
        const c = cfg()
        const selected = resolveStsSettings(c)
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        if (connection === undefined) return false
        const result = await connection.rpc.call('/voice-sts', 'probe', {
          provider: selected.provider, model: selected.model, voice: selected.voice,
          silenceSec: c.stsSilenceSec, thinking: c.stsThinking, protocol,
        })
        return result.ok && typeof result.value === 'object' && result.value !== null
          && 'ready' in result.value && result.value.ready === true
      },
      listPipelineModels: async (provider, kind, signal) => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        if (!connection) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-sts', 'pipeline-models', { provider, kind }, signal)
        if (!result.ok || typeof result.value !== 'object' || result.value === null || !('models' in result.value)
          || !Array.isArray(result.value.models) || !result.value.models.every((id: unknown): id is string => typeof id === 'string')) throw new Error('Speech model discovery failed')
        return result.value.models
      },
      listStsModels: discoverStsModels,
      localModelDownloadSize: async (request, signal) => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        if (!connection) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-local', 'install-size', request, signal)
        if (!result.ok) throw new Error(result.error.message)
        return typeof result.value === 'number' && result.value > 0 ? result.value : null
      },
      installLocalModels: async (request, signal) => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        if (!connection) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-local', request ? 'install' : 'install-status', request ?? {}, signal)
        if (!result.ok) throw new Error(result.error.message)
        const value = result.value
        if (typeof value !== 'object' || value === null || !('running' in value) || typeof value.running !== 'boolean'
          || !('phase' in value) || typeof value.phase !== 'string' || !('downloaded' in value) || typeof value.downloaded !== 'number'
          || !('total' in value) || typeof value.total !== 'number' || !('error' in value) || (value.error !== null && typeof value.error !== 'string')) {
          throw new Error('Invalid local installation status')
        }
        return { running: value.running, phase: value.phase, downloaded: value.downloaded, total: value.total, error: value.error }
      },
      listLocalModels: async (signal) => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        if (!connection) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-local', 'models', {}, signal)
        if (!result.ok || !Array.isArray(result.value)) throw new Error('Local model discovery failed')
        return parseLocalModels(result.value)
      },
      wakeReady: async (modelId, signal) => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        if (!connection) throw new Error('Voice connection unavailable')
        const result = await connection.rpc.call('/voice-local', 'wake-readiness', { modelId }, signal)
        return result.ok && typeof result.value === 'object' && result.value !== null
          && 'ready' in result.value && result.value.ready === true
      },
      listVoices: async (selection, signal) => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
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
  })
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@voicemesh/dsh-voice', locale: NS, inject: settingsInjected,
  }, VoiceSettings))
  ctx.slots.inject('plugins.bundle.activation', () => ctx.slots.register({
    name: 'plugins.bundle.activation', key: '@voicemesh/dsh-voice', locale: NS,
    inject: (): VoiceSetupPromptInjected => {
      const injected = settingsInjected()
      return {
        sources: { config: injected.sources.config, credentialStatusReady: credentialStatus },
        ...(injected.listLocalModels === undefined ? {} : { listLocalModels: injected.listLocalModels }),
      }
    },
  }, VoiceSetupPrompt))
}
