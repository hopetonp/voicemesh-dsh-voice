/** Browser status feedback injected into the shared voice lifecycle. */
import { createVoiceLifecycle as createLifecycle, type VoiceLifecycleSink } from '@voicemesh/composer'
import { createStatusSounds } from './status-sounds.ts'
export type { VoiceActivation, VoiceActivationOptions } from '@voicemesh/composer'

/**
 * Create the plugin lifecycle with its browser status player.
 * @param store - Application state projection.
 * @param settings - Inactivity and status sound preferences.
 * @param sounds - Browser status feedback.
 * @returns Shared voice activation owner.
 */
export function createVoiceLifecycle(store: VoiceLifecycleSink,
  settings: () => { voiceStandbySec: number; statusSounds: boolean },
  sounds: Pick<ReturnType<typeof createStatusSounds>, 'play' | 'stop'> = createStatusSounds()): ReturnType<typeof createLifecycle> {
  return createLifecycle(store, settings, sounds)
}
