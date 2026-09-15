/**
 * Injectable face of the voice dock entry.
 *
 * The dock owns visual state; the verbs below are the boundary it calls. The
 * `hooks` compartment exposes the two reactive stores (runtime loop state and
 * the persisted config) so the orb and the setup page share one source.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { VoiceConfig } from './config.ts'
import type { VoicePhaseState } from './state.ts'

/** The verbs + reactive sources injected into the mic dock. */
export interface MicDockActions {
  /** Toggle voice on for one session (start mic + loop). */
  onToggle(sessionId: string): void | Promise<void>
  /** Stop voice (release mic + disarm loop). */
  onStop(sessionId: string): void
  /** Toggle mute (capture suppresses the mic without stopping the loop). */
  onMute(): void
  /** Read the last agent reply back aloud. */
  onReadBack(): void
  /** Reactive sources the orb reads live. */
  sources: {
    /** Whether the resident composer exposes its compact control slot. */
    panelSupport?: ObservableSnapshot<boolean>
    /** Live loop state: phase, level, error, active seconds. */
    voice: ObservableSnapshot<VoicePhaseState>
    /** Persisted config: muted, hands-free, read-back, key. */
    config: ObservableSnapshot<VoiceConfig>
  }
}
