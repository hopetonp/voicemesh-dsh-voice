/** Voice-owned history kept outside the Harness session format. */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { StsRecordedEvent } from './sts-recording.ts'

type VoiceEventType = 'voice/sts/event' | 'voice/sts/transcript'
type VoiceTranscript = Extract<SessionEvent, { type: 'voice/sts/transcript' }>['data']

class VoiceSessionEvents {
  private readonly db: DatabaseSync

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(`CREATE TABLE IF NOT EXISTS voice_session_events (
      id INTEGER PRIMARY KEY,
      session_id TEXT NOT NULL,
      after_seq INTEGER NOT NULL,
      time_ms INTEGER NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS voice_session_events_session ON voice_session_events(session_id, id);`)
  }

  append(session: Session, type: VoiceEventType, data: StsRecordedEvent | VoiceTranscript): void {
    const json = JSON.stringify(data)
    if (json === undefined) throw new Error('Voice event is not JSON serializable')
    this.db.prepare('INSERT INTO voice_session_events (session_id, after_seq, time_ms, type, data_json) VALUES (?, ?, ?, ?, ?)')
      .run(String(session.id), session.ownEvents().length, Date.now(), type, json)
  }

  events(session: Session): readonly SessionEvent[] {
    const base = session.ownEvents()
    const rows = this.db.prepare('SELECT id, after_seq, time_ms, type, data_json FROM voice_session_events WHERE session_id = ? ORDER BY id')
      .all(String(session.id)) as { id: number; after_seq: number; time_ms: number; type: VoiceEventType; data_json: string }[]
    if (rows.length === 0) return base
    const combined: SessionEvent[] = []
    let rowIndex = 0
    for (let index = 0; index <= base.length; index++) {
      while (rows[rowIndex] !== undefined && rows[rowIndex]!.after_seq <= index) {
        const row = rows[rowIndex++]!
        if (row.type !== 'voice/sts/event' && row.type !== 'voice/sts/transcript') throw new Error('Invalid stored voice event type')
        combined.push({ type: row.type, seq: row.id, time: row.time_ms, data: JSON.parse(row.data_json) } as SessionEvent)
      }
      if (index < base.length) combined.push(base[index]!)
    }
    if (rowIndex !== rows.length) throw new Error('Voice history refers to missing Harness session events')
    return combined
  }
}

let store: VoiceSessionEvents | undefined
function voiceStore(): VoiceSessionEvents {
  return store ??= new VoiceSessionEvents(process.env.VOICEMESH_VOICE_EVENTS_DB
    ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'voice-session-events.sqlite'))
}

/** Persist a plugin event without changing the Harness session vocabulary. */
export function appendVoiceEvent(session: Session, type: 'voice/sts/event', data: StsRecordedEvent): void
export function appendVoiceEvent(session: Session, type: 'voice/sts/transcript', data: VoiceTranscript): void
export function appendVoiceEvent(session: Session, type: VoiceEventType, data: StsRecordedEvent | VoiceTranscript): void {
  voiceStore().append(session, type, data)
}

/** Read Harness events interleaved with the plugin's durable voice events. */
export function voiceSessionEvents(session: Session): readonly SessionEvent[] {
  return voiceStore().events(session)
}
