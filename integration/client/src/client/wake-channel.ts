/**
 * The wake channel as the voice client uses it.
 *
 * While the voice is parked the conversation's capture has been released — standby is a genuine
 * release, not a muted stream — so this opens **its own** microphone. Active voice pauses that
 * capture synchronously before its asynchronous device teardown, keeping the socket and keyword
 * spotter ready for the next inactive phase. Nothing here is shared with the conversation path,
 * which means a bug here cannot leak a stream into a session, and a session cannot leave this listening.
 *
 * A detection resumes the conversation through `onResume`, which the caller points at the same
 * start the user's own button calls. The client path guarantees that happens at most once per park
 * cycle, which matters because a second resume would open a capture onto a session already listening.
 */
import { createMicCapture, type MicHandle } from '@voicemesh/composer/browser'
import {
  WAKE_PREROLL_BYTES,
  createWakeClientPath,
  createWakePreroll,
  createWakeResumeGate,
  createWakeSocketTransport,
  createWakeTriggerGuard,
  type WakeClientPath,
} from '@voicemesh/composer/wake'

/** What the channel needs from its owner. */
export interface VoiceWakeChannelDeps {
  /** The host's wake channel endpoint. */
  readonly url: string
  /** Resume the parked session; called at most once per park cycle. */
  readonly onResume: () => void
  /** Report a failure worth showing the user. */
  readonly onFailure: (message: string) => void
  /** The socket closed unexpectedly, so the owner must forget this channel before its next rearm. */
  readonly onClosed?: () => void
  /** Cancels this channel when its wake configuration is replaced or removed. */
  readonly signal?: AbortSignal
  /**
   * Whether listening is still wanted. Checked on every captured chunk, because a setting changed
   * while the voice is inactive runs no lifecycle path at all — so this is the only moment the
   * channel can notice that wake was switched off, and stop holding the microphone.
   */
  readonly stillWanted?: () => boolean
}

/** A listening wake channel. */
export interface VoiceWakeChannel {
  /** Open the retained wake connection. The caller then selects whether it listens. */
  setup(): Promise<void>
  /** Start or stop microphone capture on the retained wake connection. */
  setListening(listening: boolean): Promise<void>
  /** Whether the retained wake transport is open. */
  readonly armed: boolean
}

/**
 * Build the wake channel.
 * @param deps - endpoint and the resume/failure hooks.
 * @returns the channel, unopened until `setup` is called.
 */
export function createVoiceWakeChannel(deps: VoiceWakeChannelDeps): VoiceWakeChannel {
  let socket: WebSocket | undefined
  let mic: MicHandle | undefined
  let path: WakeClientPath | undefined
  let feeding = false
  let stopping: Promise<void> = Promise.resolve()
  let parkCycle = 0
  let parkedCycle = 0

  const park = (ws: WebSocket, cycle: number): void => {
    if (socket !== ws || ws.readyState !== WebSocket.OPEN || cycle !== parkCycle || parkedCycle === cycle) return
    parkedCycle = cycle
    path?.park()
  }

  const stopListening = (): Promise<void> => {
    // Stop accepting PCM before awaiting the browser device. A rapid inactive transition must not
    // feed wake audio while the conversation microphone has taken ownership.
    feeding = false
    // Invalidate the active detection token before the asynchronous microphone stop. The host can
    // still finish a previously received frame, but it cannot resume active voice from that token.
    path?.unpark()
    const stoppingMic = mic
    mic = undefined
    if (stoppingMic === undefined) return stopping
    const next = stopping.then(() => stoppingMic.stop())
    stopping = next.catch(() => {})
    return next
  }

  const teardown = async (): Promise<void> => {
    const closing = socket
    const stopped = stopListening()
    socket = undefined
    path = undefined
    if (closing !== undefined) {
      // Drop every handler first: a connecting socket can still deliver `error` or `open` while
      // its close is in flight, after a replacement listener has started.
      closing.onopen = null
      closing.onmessage = null
      closing.onerror = null
      closing.onclose = null
      try { closing.close() } catch { /* already closing */ }
    }
    await stopped
  }

  const startListening = async (): Promise<void> => {
    const ws = socket
    if (ws === undefined || mic !== undefined) return
    await stopping
    if (socket !== ws || mic !== undefined) return
    const cycle = ++parkCycle
    const capture = createMicCapture(pcm16 => {
      if (!feeding || socket !== ws) return
      if (deps.stillWanted !== undefined && !deps.stillWanted()) {
        void teardown().finally(() => deps.onClosed?.())
        return
      }
      path?.feed(pcm16)
    })
    mic = capture
    feeding = true
    try {
      await capture.start()
      if (socket === ws && mic === capture) park(ws, cycle)
    } catch (error) {
      if (mic === capture) await teardown()
      throw error
    }
  }

  deps.signal?.addEventListener('abort', () => { void teardown() }, { once: true })

  return {
    get armed(): boolean { return socket !== undefined },
    async setup(): Promise<void> {
      if (socket !== undefined || deps.signal?.aborted) return
      const ws = new WebSocket(deps.url)
      socket = ws
      const wire = createWakeSocketTransport(
        {
          // A frame sent before the socket opens would throw; dropping it is correct, because the
          // park announcement is re-sent when the socket opens.
          send: data => {
            if (ws.readyState !== WebSocket.OPEN) return
            // The module hands over a plain Uint8Array of PCM16; the DOM's send wants a view over
            // an ArrayBuffer specifically, which a generic Uint8Array is not assignable to. The
            // data is unchanged — this is a typing gap, not a conversion.
            ws.send(typeof data === 'string' ? data : (data as Uint8Array<ArrayBuffer>))
          },
          close: () => { ws.close() },
        },
        raw => path?.receive(raw),
      )
      path = createWakeClientPath({
        transport: wire.transport,
        preroll: createWakePreroll(WAKE_PREROLL_BYTES),
        gate: createWakeResumeGate(),
        guard: createWakeTriggerGuard(),
        onResume: () => { deps.onResume() },
        onFailure: error => { deps.onFailure(error.message) },
      })
      ws.onmessage = event => {
        if (socket !== ws) return
        // Only text carries a down frame; audio only ever travels upward.
        wire.deliver(event.data, typeof event.data !== 'string')
      }
      ws.onerror = () => {
        if (socket !== ws) return
        deps.onFailure('Wake listener connection failed')
        void teardown().finally(() => deps.onClosed?.())
      }
      ws.onclose = () => {
        if (socket !== ws) return
        void teardown().finally(() => deps.onClosed?.())
      }
      // Park once the socket is actually open, so the announcement is not dropped.
      ws.onopen = () => {
        if (socket !== ws) return
        // If capture is still starting, its completion parks this cycle. If it is already live,
        // park here; `parkedCycle` makes an open racing capture completion one announcement.
        if (mic !== undefined) park(ws, parkCycle)
        ws.onopen = null
      }
    },
    setListening(listening: boolean): Promise<void> {
      return listening ? startListening() : stopListening()
    },
  }
}

/**
 * Whether the wake listener should be open.
 *
 * The rule is "whenever the voice is not active", not "only while parked" — idle before the first
 * activation, parked, and stopped are all inactive states, and the phrase is expected to work in
 * each of them. A phrase and selected wake model are required before opening the listener.
 *
 * @param config - the settings that govern listening.
 * @param active - whether the voice is currently active.
 * @returns true when the listener should be armed.
 */
export function shouldListen(
  config: { readonly wakeEnabled: boolean; readonly wakePhrase: string; readonly wakeModelId: string },
  active: boolean,
): boolean {
  if (active) return false
  if (!config.wakeEnabled) return false
  return config.wakePhrase.trim() !== '' && config.wakeModelId.trim() !== ''
}
