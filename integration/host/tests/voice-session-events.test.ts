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

test('speech transcripts enter the Harness feed used by message history', async () => {
  const { StsRecording } = await import('../src/sts-recording.ts')
  const events: SessionEvent[] = []
  let flushed = false
  const session = {
    id: 'transcript-session',
    ownEvents: () => events,
    append: (type: string, data: SessionEvent['data']) => {
      events.push({ type, seq: events.length, time: Date.now(), data } as SessionEvent)
    },
  } as Session
  const recording = new StsRecording('conversation' as never, session, undefined, async () => { flushed = true; return true })
  const signal = new AbortController().signal
  await recording.recordTranscript('user', 'hello', signal, 'input', 'final')
  await recording.recordTranscript('assistant', 'hi', signal, 'output', 'final')
  assert.equal(flushed, true)
  assert.deepEqual(events.map(event => [event.type, event.data.role, event.data.text]), [
    ['voice/sts/transcript', 'user', 'hello'],
    ['voice/sts/transcript', 'assistant', 'hi'],
  ])
})
