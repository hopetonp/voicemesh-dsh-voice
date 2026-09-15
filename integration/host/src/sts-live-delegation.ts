/** Harness task policy supplied to the reusable Live coordinator. */
import { LiveDelegation as VoiceLiveDelegation, type LiveContextTiming } from '@voicemesh/composer'
import { voiceTaskResult, voiceTaskResultInstructions, spokenReportInstructions } from '@dsh-voice/harness-policy'
import type { StsMessage } from '@voicemesh/composer/server'
import type { StsTasks } from './sts-tasks.ts'
import type { StsRecording } from './sts-recording.ts'

/** Link generic Live delegation to the selected coding session. */
export class LiveDelegation extends VoiceLiveDelegation {
  constructor(tasks: Pick<StsTasks, 'dispatch' | 'steer' | 'states'>,
    recording: Pick<StsRecording, 'recordTranscript'>,
    send: (event: StsMessage & { event_id: string }, eligible: () => boolean) => Promise<unknown>, signal: AbortSignal,
    maxContextBytes: number, fail: () => void, timing: LiveContextTiming,
    reportInstructions = spokenReportInstructions, context: () => string = () => '',
    delivery?: (requestId: string, phase: 'pending' | 'accepted') => void) {
    super(tasks, recording, send, signal, maxContextBytes, fail, {
      request: lines => 'Handle the latest user request in this live voice conversation. Earlier lines are context, not new tasks. '
        + 'Transcripts may contain unfinished speech and corrections. '
        + voiceTaskResultInstructions + ' Apply this spoken-output policy only to the opening paragraph: '
        + reportInstructions + (context() === '' ? '' : '\nApplication context:\n' + context()) + '\nConversation context:\n'
        + lines.map(item => `${item.role}: ${item.text}`).join('\n'),
      missingTranscript: 'The request transcript has not arrived. Please repeat your request.',
      accepted: 'The requested work was accepted. Completion will arrive automatically. Do not repeat acknowledgments or progress filler.',
      rejected: 'The application could not accept this request. Do not claim that work started or completed.',
      result: voiceTaskResult,
    }, timing, (state, phase) => { delivery?.(state.requestId, phase) })
  }
}
