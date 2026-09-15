/** Harness signaling and settings supplied to the reusable realtime controller. */
import { createStsController as createController, type StsController } from '@voicemesh/composer/browser'
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
 * @param commandFailureText - Localized recoverable command notice.
 * @param sessions - public session-selection feed; no file or panel selection is exposed.
 * @returns Realtime voice controller.
 */
export function createStsController(config: () => VoiceConfig, voice: VoiceRuntimeStore, failureText: string,
  watchCompletion: (sessionId: SessionId, notify: (turn: number) => void) => () => void = () => () => {},
  transcriptionFailureText: string = failureText, lifecycle = createVoiceLifecycle(voice, config),
  commandFailureText: string = failureText, sessions?: Pick<ISessions, 'list'>): StsController<SessionId> {
  const selection = (sessionId: SessionId): 'linked' | 'other' | 'none' | 'unknown' => {
    if (sessions === undefined) return 'unknown'
    const current = sessions.list.getSnapshot().current
    return current === undefined ? 'none' : current === sessionId ? 'linked' : 'other'
  }
  return createController(config, voice, failureText, watchCompletion, transcriptionFailureText, lifecycle, {
    commandFailureText,
    resolve(settings) {
      const provider = resolveStsSettings(settings)
      if (provider.credential.trim() === '') throw new Error(failureText)
      return { ...provider, nativePlayback: provider.provider === 'openai-live',
        ...(provider.transport === 'webrtc' ? { rtcAdapter: () => createStsWebRtcAdapter(provider.provider, settings) } : {}) }
    },
    socket: () => new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/voice-sts/live`),
    start: (sessionId, settings, _provider, offer) => {
      const provider = resolveStsSettings(settings)
      return { ...(offer === undefined ? {} : { offer }), type: 'start', responseDetail: settings.responseDetail,
        sessionId, ...(provider.provider === 'openai-live' ? { selection: selection(sessionId) } : {}), provider: provider.provider, model: provider.model, voice: provider.voice, silenceSec: settings.stsSilenceSec,
        thinking: settings.stsThinking, endConversationEnabled: settings.endConversationEnabled,
        transcriptHistory: settings.transcriptHistory, backchannelEnabled: settings.backchannelEnabled }
    },
    refresh: settings => ({ type: 'voice.transcript-history', enabled: settings.transcriptHistory }),
    watchContext(sessionId, provider, send) {
      if (provider.provider !== 'openai-live' || sessions === undefined) return () => {}
      let previous: string | undefined
      const publish = (): void => {
        const current = selection(sessionId)
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
