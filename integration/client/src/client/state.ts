/**
 * Live voice runtime state for the DSH surface.
 *
 * A single reactive snapshot store shared by the mic dock (the orb) and the
 * voice setup page. The loop publishes every transition here; the components
 * subscribe through `subscribe`/`getSnapshot` (React's `useSyncExternalStore`).
 *
 * This is a *runtime* view — it is intentionally not persisted. What the user
 * configures (key, toggles) lives in `config.ts`; what the loop is doing right
 * now lives here.
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The visible voice phase. Mirrors the Flutter `VoiceState` for parity. */
export type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'preparing'
  | 'transcribing'
  | 'speaking'
  | 'standby'
  | 'error'

/** Speech-detection (VAD) health, reported to the UI so a degraded mode is visible. */
export interface VoiceVadStatus {
  /** The active VAD engine: `silero` (model-backed) or `energy` (fallback). */
  engine: 'silero' | 'energy'
  /** Why it degraded to energy (wasm/CDN/CSP block), or null when healthy. */
  degradedReason: string | null
}

/** One point-in-time view of the voice loop. */
export interface VoicePhaseState {
  /** Current loop phase. */
  phase: VoicePhase
  /** Human-readable error message when phase is `error`. */
  error: string | null
  /** Live microphone level (0..1), for the orb swell. */
  level: number
  /** Cumulated active seconds (listening/transcribing/speaking), not idle/standby. */
  activeSeconds: number
  /** The live in-progress transcript (streaming STT), empty when none. */
  transcript: string
  /** The most recent agent reply, for the "read back last output" action. */
  lastReply: string
  /** Speech-detection health (silero ready vs. energy fallback). */
  vadStatus: VoiceVadStatus | null
}

/** The reactive voice runtime store: snapshot source plus explicit setters. */
export interface VoiceRuntimeStore {
  readonly getSnapshot: () => VoicePhaseState
  readonly subscribe: (fn: () => void) => () => void
  setPhase(phase: VoicePhase): void
  setError(error: string | null): void
  setLevel(level: number): void
  setActiveSeconds(seconds: number): void
  setTranscript(transcript: string): void
  setLastReply(lastReply: string): void
  setVadStatus(status: VoiceVadStatus | null): void
}

/** Initial runtime state: voice off, no error, silent. */
export const INITIAL_VOICE_STATE: VoicePhaseState = {
  phase: 'idle',
  error: null,
  level: 0,
  activeSeconds: 0,
  transcript: '',
  lastReply: '',
  vadStatus: null,
}

/**
 * Build a fresh voice runtime store. Created once per plugin apply, never at
 * module scope, so plugin reloads cannot inherit a live loop's state.
 *
 * The store flushes per animation frame: the mic level publishes dozens of
 * times a second, and the orb only needs the latest value per frame.
 */
export function createVoiceRuntimeStore(): VoiceRuntimeStore {
  const store: SnapshotStore<VoicePhaseState> = createSnapshotStore(
    INITIAL_VOICE_STATE,
    { flush: 'raf' },
  )
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    setPhase: phase => store.update((s) => { s.phase = phase }),
    setError: error => store.update((s) => { s.error = error }),
    setLevel: level => store.update((s) => { s.level = level }),
    setActiveSeconds: seconds => store.update((s) => { s.activeSeconds = seconds }),
    setTranscript: transcript => store.update((s) => { s.transcript = transcript }),
    setLastReply: lastReply => store.update((s) => { s.lastReply = lastReply }),
    setVadStatus: vadStatus => store.update((s) => { s.vadStatus = vadStatus }),
  }
}

/** Format a seconds count as `m:ss` (e.g. 83 → "1:23"). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** Whether a phase is "active" for the session clock (billable-ish time). */
export function isActivePhase(phase: VoicePhase): boolean {
  return phase === 'listening' || phase === 'transcribing' || phase === 'preparing' || phase === 'speaking'
}

/**
 * The orb's outer-ring color for a phase. White while connecting (no capture
 * yet), blue while capturing, amber while transcribing, green while speaking,
 * dimmed listening color while parked (standby), and the error colour (red-ish) on failure.
 */
export function phaseColor(phase: VoicePhase, error: string | null): string {
  if (error !== null) return 'var(--dsw-alias-state-error-primary, #c2544d)'
  switch (phase) {
    case 'connecting':
      return 'var(--dsw-alias-label-primary-foreground, #ffffff)'
    case 'listening':
      return 'var(--dsw-alias-brand-primary, #4b8bf5)'
    case 'preparing':
    case 'transcribing':
      return 'var(--dsw-alias-state-warn-primary, #f2a33c)'
    case 'speaking':
      return 'var(--dsw-alias-state-success-primary, #2ea043)'
    case 'standby':
      return `color-mix(in srgb, ${phaseColor('listening', null)} 45%, black)`
    case 'idle':
    default:
      return 'var(--dsw-alias-brand-primary, #4b8bf5)'
  }
}

/** A short, tabular-friendly label for one phase (no punctuation). */
export function phaseLabel(phase: VoicePhase, error: string | null): string {
  if (error !== null) return 'Voice error'
  switch (phase) {
    case 'connecting':
      return 'Connecting'
    case 'listening':
      return 'Listening'
    case 'preparing':
      return 'Preparing speech'
    case 'transcribing':
      return 'Transcribing'
    case 'speaking':
      return 'Speaking'
    case 'standby':
      return 'Standing by'
    case 'idle':
    default:
      return 'Voice off'
  }
}
