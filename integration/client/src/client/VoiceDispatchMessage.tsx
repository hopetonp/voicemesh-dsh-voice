/** Chat renderer override for internal voice-to-coding instructions. */
import { useSyncExternalStore } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { normalizeVoiceConfig, type VoiceConfig } from './config.ts'

/** Observable voice settings supplied by the owning plugin. */
export interface VoiceDispatchSettings {
  readonly getSnapshot: () => Partial<VoiceConfig>
  readonly subscribe: (listener: () => void) => () => void
}

/** Keep coding instructions logged without duplicating the enabled speech transcript. */
export function VoiceDispatchMessage(props: Pick<ChatNodeViewProps<'user' | 'steering'>, 'node' | 'renderMessageImages' | 't' | 'UserMessageView'> & { voiceSettings: VoiceDispatchSettings }) {
  const settings = normalizeVoiceConfig(useSyncExternalStore(props.voiceSettings.subscribe, props.voiceSettings.getSnapshot))
  const source = props.node.data.source
  if (settings.transcriptHistory && typeof source === 'object' && source !== null && 'kind' in source && source.kind === 'user' && 'rpcId' in source
    && typeof source.rpcId === 'string' && /^voice:[a-f0-9]{64}$/.test(source.rpcId)) return null
  const NativeMessage = props.UserMessageView
  return <NativeMessage {...props} />
}
