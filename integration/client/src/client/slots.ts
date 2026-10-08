/**
 * Injectable face of the voice dock entry.
 *
 * The control owns visual state; the verbs below are the boundary it calls. The
 * `hooks` compartment exposes the two reactive stores (runtime loop state and
 * the persisted config) so the composer control and the setup page share one
 * source.
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { VoiceConfig } from './config.ts'
import type { VoicePhaseState } from './state.ts'
import type { VoiceCredentialSlot } from './voice-credentials.ts'

/** The verbs + reactive sources injected into the voice control. */
export interface MicDockActions {
  /** Toggle voice on for one session (start mic + loop). */
  onToggle(sessionId: string): void | Promise<void>
  /** Stop voice (release mic + disarm loop). */
  onStop(sessionId: string): void
  /** Toggle mute (capture suppresses the mic without stopping the loop). */
  onMute(): void
  /** Toggle speaker mute (silences playback without stopping the loop). */
  onSpeakerMute(): void
  /** Read the last agent reply back aloud. */
  onReadBack(): void
  /** Missing host-managed keys for the currently selected voice route. */
  missingCredentials(): readonly VoiceCredentialSlot[]
  /** Open the existing VoiceMesh settings page. */
  onOpenSetup(): void
  /**
   * Discover the realtime models the selected provider offers, each with the thinking states it
   * acts on. The composer's tip asks for this when it first opens: the level it names must be one
   * the provider honours, and only the catalog knows which those are.
   */
  listStsModels?(signal: AbortSignal): Promise<readonly import('./sts-model.ts').StsModelListing[]>
  /** Reactive sources the control reads live. */
  sources: {
    /** Live loop state: phase, level, error, active seconds. */
    voice: ObservableSnapshot<VoicePhaseState>
    /** Persisted config: muted, hands-free, read-back, key. */
    config: ObservableSnapshot<VoiceConfig>
  }
}
