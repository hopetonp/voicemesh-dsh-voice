import type { Session } from '@deepseek-ai/dsh-session'
import type { VoiceTranscript } from './voice-session-events.ts'

declare module '@deepseek-ai/dsh-session' {
  export function appendPluginRecord(
    session: Session,
    type: 'plugin:voicemesh/transcript',
    data: VoiceTranscript,
  ): void
}
