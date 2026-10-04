import assert from 'node:assert/strict'
import test from 'node:test'
import { hideVoiceDispatch } from '../../client/src/client/voice-dispatch-visibility.ts'
import { latestLiveUserRequest } from '../src/live-task-instruction.ts'

test('uses only the latest spoken user request for queued and steered coding work', () => {
  const instruction = latestLiveUserRequest([
    { role: 'user', text: 'Earlier request that is context only.' },
    { role: 'assistant', text: 'Acknowledged.' },
    { role: 'user', text: '  Update the task title.  ' },
  ])

  assert.equal(instruction, 'Update the task title.')
  for (const admitted of [{ instruction }, { instruction }]) {
    assert.equal(admitted.instruction, 'Update the task title.')
    assert.doesNotMatch(admitted.instruction, /Earlier request|Acknowledged|PRIVATE_POLICY/)
  }
})

test('refuses an admission without a spoken user request', () => {
  assert.throws(() => latestLiveUserRequest([{ role: 'assistant', text: 'Can I help?' }]), /no user request/)
})

test('keeps one visible user bubble when transcript history is enabled', () => {
  const source = { kind: 'user', rpcId: `voice:${'a'.repeat(64)}` }
  assert.equal(hideVoiceDispatch(source, true), true)
  assert.equal(hideVoiceDispatch(source, false), false)
})
