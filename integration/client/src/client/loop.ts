/** Harness composition of the reusable speech pipeline and browser status cues. */
import { buildVoiceLoop as buildPipeline, type VoiceLoopHost, type VoiceLoopRead, type VoiceLoopOptions, type VoiceLoop } from '@voicemesh/composer/pipeline'
import type { VoiceRuntimeStore } from './state.ts'
import { createVoiceLifecycle } from './voice-lifecycle.ts'
export * from '@voicemesh/composer/pipeline'

/**
 * Compose a pipeline with the plugin's shared lifecycle feedback.
 * @param host - Application speech and conversation operations.
 * @param store - Reactive voice state.
 * @param read - Current user preferences.
 * @param options - Lifecycle and speech detection composition.
 * @returns Configured voice pipeline.
 */
export function buildVoiceLoop(host: VoiceLoopHost, store: VoiceRuntimeStore, read: () => VoiceLoopRead,
  options: VoiceLoopOptions = {}): VoiceLoop {
  return buildPipeline(host, store, read, { ...options, lifecycle: options.lifecycle ?? createVoiceLifecycle(store,
    () => ({ voiceStandbySec: read().voiceStandbySec ?? 0, statusSounds: read().statusSounds ?? true })) })
}
