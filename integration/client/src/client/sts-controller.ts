/** Harness signaling and settings supplied to the reusable realtime controller. */
import { createStsController as createController, type StsController, type StsFailureText } from '@voicemesh/composer/browser'
import { hostWebSocketUrl } from './host-address.ts'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { VoiceConfig } from './config.ts'
import type { VoiceRuntimeStore } from './state.ts'
import { resolveStsSettings, createStsWebRtcAdapter } from './sts-settings.ts'
import { createVoiceLifecycle } from './voice-lifecycle.ts'
export type { StsController } from '@voicemesh/composer/browser'

/**
 * Connect the selected harness session to the browser voice runtime.
 * @param config - Current voice settings.
 * @param voice - Reactive voice state.
 * @param failureText - Localized connection failure.
 * @param watchCompletion - Completed application turn subscription.
 * @param transcriptionFailureText - Localized caption failure.
 * @param lifecycle - Shared activation and status feedback.
 * @param commandFailureText - Localized provider context-delivery failure.
 * @param sessions - public session-selection feed; no file or panel selection is exposed.
 * @returns Realtime voice controller.
 */
export function createStsController(config: () => VoiceConfig, voice: VoiceRuntimeStore, failureText: StsFailureText,
  watchCompletion: (sessionId: SessionId, notify: (turn: number) => void) => () => void = () => () => {},
  transcriptionFailureText?: string, lifecycle = createVoiceLifecycle(voice, config),
  commandFailureText?: string, sessions?: Pick<ISessions, 'list'>, missingModelText?: string): StsController<SessionId> {
  // Sites that carry no reason of their own still need plain text (a missing
  // credential, a caption warning, a command notice).
  const baseText = typeof failureText === 'function' ? failureText({ reason: 'start' }) : failureText
  // This version has no client-side notion of a session being "current": the conversation view is
  // bound to the session it renders, and voice is mounted for that same session, so a session voice
  // was started for is the linked one. Without a session feed nothing can be said about a binding.
  const selection = (): 'linked' | 'other' | 'none' | 'unknown' => sessions === undefined ? 'unknown' : 'linked'
  return createController(config, voice, failureText, watchCompletion, transcriptionFailureText ?? baseText, lifecycle, {
    commandFailureText: commandFailureText ?? baseText,
    resolve(settings) {
      const provider = resolveStsSettings(settings)
      if (provider.credential.trim() === '') throw new Error(baseText)
      // The host's start contract requires a model and a voice, and answers a start without one by
      // closing the socket. Naming the missing choice here turns that close into the same prompt the
      // model picker shows, instead of a connection failure the user cannot act on.
      if (provider.model.trim() === '') throw new Error(missingModelText ?? baseText)
      if (provider.voice.trim() === '') throw new Error(baseText)
      return { ...provider, nativePlayback: provider.provider === 'openai-live',
        ...(provider.transport === 'webrtc' ? { rtcAdapter: () => createStsWebRtcAdapter(provider.provider, settings) } : {}) }
    },
    socket: () => new WebSocket(hostWebSocketUrl('/voice-sts/live')),
    start: (sessionId, settings, _provider, offer) => {
      const provider = resolveStsSettings(settings)
      return { ...(offer === undefined ? {} : { offer }), type: 'start', responseDetail: settings.responseDetail, progressMode: settings.progressMode,
        plainLanguageSummaries: settings.plainLanguageSummaries,
        sessionId, ...(provider.provider === 'openai-live' ? { selection: selection() } : {}), provider: provider.provider, model: provider.model, voice: provider.voice, silenceSec: settings.stsSilenceSec,
        thinking: settings.stsThinking, endConversationEnabled: settings.endConversationEnabled,
        transcriptHistory: settings.transcriptHistory, backchannelEnabled: settings.backchannelEnabled }
    },
    refresh: settings => ({ type: 'voice.transcript-history', enabled: settings.transcriptHistory }),
    watchContext(_sessionId, provider, send) {
      if (provider.provider !== 'openai-live' || sessions === undefined) return () => {}
      let previous: string | undefined
      const publish = (): void => {
        const current = selection()
        if (current === previous) return
        previous = current
        send({ type: 'voice.context', selection: current })
      }
      const unsubscribe = sessions.list.subscribe(publish)
      try { publish() }
      catch (error) { unsubscribe(); throw error }
      return unsubscribe
    },
    canEnd: settings => settings.endConversationEnabled,
  })
}
