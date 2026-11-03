import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

test('provider history stays outside the Harness log and retains its position', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'voicemesh-voice-events-'))
  process.env.VOICEMESH_VOICE_EVENTS_DB = join(directory, 'events.sqlite')
  try {
    const { appendVoiceEvent, voiceSessionEvents } = await import('../src/voice-session-events.ts')
    const harness: SessionEvent[] = []
    const session = {
      id: 'test-session',
      ownEvents: () => harness,
      append: () => { throw new Error('voice event must not enter Harness Session') },
    } as unknown as Session
    appendVoiceEvent(session, 'voice/sts/event', {
      conversationId: 'conversation' as never,
      direction: 'connection',
      event: { type: 'coding-task.intent', requestId: 'request-1' },
    })
    harness.push({ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } } as SessionEvent)
    assert.deepEqual(voiceSessionEvents(session).map(event => event.type), [
      'voice/sts/event', 'turn/start',
    ])
    assert.equal(harness.length, 1)
  } finally {
    delete process.env.VOICEMESH_VOICE_EVENTS_DB
    rmSync(directory, { recursive: true, force: true })
  }
})

test('speech transcripts persist as plugin records, never as Session events', async () => {
  const { StsRecording } = await import('../src/sts-recording.ts')
  const { transcriptRowOf } = await import('../src/voice-session-events.ts')
  const written: { type: string; data: unknown }[] = []
  const session = {
    id: 'transcript-session',
    ownEvents: () => [],
    // A Session event type the installed Harness does not know refuses the log on reopen.
    append: () => { throw new Error('voice transcript must not enter the Harness Session') },
  } as unknown as Session
  const recording = new StsRecording('conversation' as never, session, undefined, async () => true,
    undefined, (_session, type, data) => { written.push({ type, data }) })
  const signal = new AbortController().signal
  await recording.recordTranscript('user', 'hello', signal, 'input', 'final')
  await recording.recordTranscript('assistant', 'hi', signal, 'output', 'final', true)

  assert.deepEqual(written.map(entry => entry.type), ['plugin:voicemesh/transcript', 'plugin:voicemesh/transcript'])
  assert.deepEqual(written[0]!.data, { conversationId: 'conversation', role: 'user', text: 'hello', streamId: 'input', phase: 'final' })
  assert.deepEqual(written[1]!.data, { conversationId: 'conversation', role: 'assistant', text: 'hi', streamId: 'output', phase: 'final', interrupted: true })

  // The row stays readable by the plugin whichever generation wrote it.
  const current = { type: written[0]!.type, seq: 0, time: 0, data: written[0]!.data } as SessionEvent
  const legacy = { type: 'voice/sts/transcript', seq: 1, time: 1, data: { conversationId: 'conversation', role: 'user', text: 'old', streamId: 'input', phase: 'final' } } as SessionEvent
  assert.equal(transcriptRowOf(current)?.text, 'hello')
  assert.equal(transcriptRowOf(legacy)?.text, 'old')
  assert.equal(transcriptRowOf({ type: 'turn/start', seq: 2, time: 2, data: { turn: 1 } } as SessionEvent), undefined)
})
