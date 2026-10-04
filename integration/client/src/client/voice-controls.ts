/** Mode-independent commands for the voice plugin's active adapter. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Provider operations selected by the shared voice controls. */
interface VoiceAdapter {
  start(sessionId: SessionId): Promise<void>
  stop(): void | Promise<void>
  /** Park the active mode now; its next activation resumes the same session. */
  standby(): void
  readBackOutput(sessionId: SessionId): Promise<void>
}

/**
 * Route both modes through the same activation, pause, and resource-release sequence.
 * @param select - adapter selected by the current voice settings.
 * @returns shared user commands; stop cancels an activation waiting for prior teardown.
 */
export function createVoiceControls(select: () => VoiceAdapter) {
  let owner: VoiceAdapter | undefined
  let generation = 0
  let releasing: Promise<void> | undefined
  const stop = (): Promise<void> => {
    generation++
    const previous = owner
    owner = undefined
    if (previous !== undefined) releasing = Promise.resolve(previous.stop())
    return releasing ?? Promise.resolve()
  }
  const run = async (sessionId: SessionId, readBack: boolean): Promise<void> => {
    const adapter = select()
    if (owner !== undefined && owner !== adapter) stop()
    const ownGeneration = ++generation
    if (releasing !== undefined) await releasing
    if (ownGeneration !== generation) return
    owner = adapter
    try {
      if (readBack) await adapter.readBackOutput(sessionId)
      else await adapter.start(sessionId)
    } catch (error) {
      if (ownGeneration === generation) throw error
    }
  }
  return {
    start: (sessionId: SessionId): Promise<void> => run(sessionId, false),
    readBackOutput: (sessionId: SessionId): Promise<void> => run(sessionId, true),
    /** Park the active mode; a mode that never started has nothing to park. */
    standby: (): void => { owner?.standby() },
    stop,
  }
}
