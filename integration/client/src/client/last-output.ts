/** Host-backed access to saved coding output for read-back. */
const LAST_OUTPUT_PATH = '/api/voice/last-output'

/** Read the host-stored last raw agent output for a session (durable). */
export async function readLastOutputRemote(sessionId: string): Promise<string> {
  try {
    const res = await fetch(`${LAST_OUTPUT_PATH}/${encodeURIComponent(sessionId)}`)
    if (!res.ok) return ''
    const data = (await res.json()) as { ok: boolean; text: string }
    return data.ok ? data.text.trim() : ''
  } catch {
    return ''
  }
}

/** Persist the last raw agent output for a session on the host (durable). */
export async function writeLastOutputRemote(sessionId: string, text: string): Promise<void> {
  try {
    await fetch(`${LAST_OUTPUT_PATH}/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch {
    // best-effort; read-back falls back to the session log
  }
}
