/** React state for provider-independent sample playback. */
import { useEffect, useRef, useState } from 'react'
import { VoicePreviewPlayer } from '@voicemesh/composer/browser'
import type { VoiceCatalogActions, VoiceSelection } from './voice-catalog.ts'

/**
 * Own a cancellable preview for the selected provider and voice.
 * @param selection - Selected provider, mode, and model.
 * @param previewVoice - Authenticated preview generator.
 * @returns Preview state and playback actions.
 */
export function useVoicePreview(selection: VoiceSelection, previewVoice: VoiceCatalogActions['previewVoice']): {
  loading: string | null
  playing: string | null
  sampleError: boolean
  preview(voice: string): Promise<void>
  stop(): void
} {
  const [loading, setLoading] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [sampleError, setSampleError] = useState(false)
  const playback = useRef<VoicePreviewPlayer | null>(null)
  const { provider, mode, model } = selection
  const stop = (): void => {
    const current = playback.current
    playback.current = null
    if (current) void current.close().catch(() => { /* An already-closed device needs no further cleanup. */ })
    setLoading(null)
    setPlaying(null)
  }
  useEffect(() => () => { stop() }, [provider, mode, model, previewVoice])
  const preview = async (voice: string): Promise<void> => {
    const wasPlaying = playing === voice || loading === voice
    stop()
    setSampleError(false)
    if (wasPlaying) return
    let player: VoicePreviewPlayer
    try { player = new VoicePreviewPlayer() }
    catch { setSampleError(true); return }
    playback.current = player
    setLoading(voice)
    try {
      await player.play((signal, append) => previewVoice({ provider, mode, model }, voice, signal, append), () => {
        if (playback.current !== player) return
        setLoading(null)
        setPlaying(voice)
      })
    } catch {
      if (playback.current === player) setSampleError(true)
    } finally {
      if (playback.current === player) stop()
    }
  }
  return { loading, playing, sampleError, preview, stop }
}
