/** Immutable PCM objects referenced by durable voice-conversation records. */
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Content address of a recorded STS PCM object. */
export type StsAudioId = Branded<'voice-sts-audio'>

/** Durable audio-reference parser shared by storage and Session reconstruction. */
export const stsAudioRefSchema = z.object({
  id: z.string().regex(/^sha256:[a-f0-9]{64}$/).transform(value => brandString<StsAudioId>(value)),
  bytes: z.number().int().positive(),
  sampleRate: z.union([z.literal(16000), z.literal(24000)]),
  encoding: z.literal('pcm16le-mono'),
}).strict()

/** Exact encoding and content digest of one recorded provider audio chunk. */
export type StsAudioRef = z.infer<typeof stsAudioRefSchema>

/** Limits resolved by the host before opening the audio store. */
export interface StsAudioStoreLimits {
  readonly maxChunkBytes: number
  readonly maxStoredBytes: number
}

function digest(bytes: Uint8Array): StsAudioId {
  return brandString<StsAudioId>(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
}

/** Durable audio objects; Session-event publication follows successful save. */
export class StsAudioStore {
  private readonly database: DatabaseSync
  private closed = false

  /**
   * Open a dedicated audio database with full synchronous commits.
   * @param path - owner-private existing directory plus database file name.
   * @param limits - audio object and aggregate storage limits.
   */
  constructor(path: string, private readonly limits: StsAudioStoreLimits) {
    const database = new DatabaseSync(path)
    this.database = database
    try {
      database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;')
      const version = database.prepare('PRAGMA user_version').get()?.user_version
      if (version !== 0 && version !== 1) throw new Error('Unsupported STS audio storage version')
      if (version === 0 && database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length !== 0) {
        throw new Error('STS audio database contains an unrecognized format')
      }
      database.exec('CREATE TABLE IF NOT EXISTS audio_objects (id TEXT PRIMARY KEY, pcm BLOB NOT NULL); PRAGMA user_version=1;')
    } catch (error) { database.close(); throw error }
  }

  /**
   * Commit sample-aligned PCM16 before returning its immutable reference.
   * @param pcm - exact mono little-endian PCM16 sent to or received from the provider.
   * @param sampleRate - PCM clock rate retained in the durable reference.
   * @returns a content-addressed reference after the synchronous commit.
   */
  save(pcm: Uint8Array, sampleRate: 16000 | 24000 = 16000): StsAudioRef {
    this.assertOpen()
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0 || pcm.byteLength > this.limits.maxChunkBytes) {
      throw new Error('STS audio chunk violates the configured PCM16 size limit')
    }
    const id = digest(pcm)
    const ref: StsAudioRef = { id, bytes: pcm.byteLength, sampleRate, encoding: 'pcm16le-mono' }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.database.prepare('SELECT pcm FROM audio_objects WHERE id = ?').get(id)
      if (existing === undefined) {
        const used = this.database.prepare('SELECT COALESCE(SUM(length(pcm)), 0) AS bytes FROM audio_objects').get()?.bytes
        if (typeof used !== 'number' || used + pcm.byteLength > this.limits.maxStoredBytes) {
          throw new Error('STS audio storage reached its configured capacity')
        }
        this.database.prepare('INSERT INTO audio_objects (id, pcm) VALUES (?, ?)').run(id, pcm)
      } else {
        this.verify(ref, existing.pcm)
      }
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
    return ref
  }

  /**
   * Reconstruct an audio input from a durable, untrusted reference.
   * @param input - reference decoded from a voice-conversation record.
   * @returns exact PCM bytes after length and digest verification.
   */
  read(input: unknown): Uint8Array {
    this.assertOpen()
    const ref = stsAudioRefSchema.parse(input)
    const row = this.database.prepare('SELECT pcm FROM audio_objects WHERE id = ?').get(ref.id)
    if (row === undefined) throw new Error('Recorded STS audio is missing')
    return this.verify(ref, row.pcm)
  }

  /** Release the database; repeated calls have no effect. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('STS audio storage is closed')
  }

  private verify(ref: StsAudioRef, value: unknown): Uint8Array {
    if (!(value instanceof Uint8Array) || value.byteLength !== ref.bytes || digest(value) !== ref.id) {
      throw new Error('Recorded STS audio failed integrity verification')
    }
    return value
  }
}
