/** Plain spoken text rendered by the optional voice/history integration. */
import { memo, useEffect } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import css from './VoiceTranscriptNodeView.module.css'

/** Render one live or saved speech bubble using the conversation theme. */
export const VoiceTranscriptNodeView = memo(function VoiceTranscriptNodeView({ node }: Pick<ChatNodeViewProps<'voice-transcript'>, 'node'>) {
  const data = node.data
  useEffect(() => {
    const name = 'dsh.voice.history-render'
    performance.mark(name, { detail: {
      ageMs: Math.max(0, Date.now() - data.time), phase: data.phase, role: data.role, seq: data.seq,
    } })
    const clear = setTimeout(() => { performance.clearMarks(name) }, 0)
    return () => { clearTimeout(clear) }
  }, [data.phase, data.role, data.seq, data.time])
  return <div className={data.role === 'user' ? css.userRow : css.assistantRow}>
    <div className={data.role === 'user' ? css.bubble : css.speech}>{data.text}</div>
  </div>
})
