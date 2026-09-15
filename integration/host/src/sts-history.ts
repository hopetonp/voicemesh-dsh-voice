/** Bounded text context for replacing a provider session without replaying work. */
import type { StsMessage } from '@voicemesh/composer/server'

/** Recent spoken turns and completed tool exchanges; no audio or credentials are retained. */
export class StsHistory {
  private readonly entries = new Map<string, StsMessage>()
  private sequence = 0
  /** @param maxBytes - maximum retained serialized context size. */
  constructor(private readonly maxBytes: number) {}

  private put(id: string, item: StsMessage): void {
    this.entries.set(id, item)
    while (Buffer.byteLength(JSON.stringify([...this.entries])) > this.maxBytes) {
      const first = this.entries.keys().next().value
      if (first === undefined) break
      this.entries.delete(first)
    }
  }

  /** Reserve chronological placement before a delayed transcript arrives.
   * @param id - provider item or response identity.
   * @param role - speaker. */
  reserve(id: string, role: 'user' | 'assistant'): void {
    if (!this.entries.has(id)) this.text(id, role, '')
  }

  /** Retain the latest transcript, including only the assistant prefix actually played.
   * @param id - item or response identity.
   * @param role - speaker.
   * @param text - spoken text. */
  text(id: string, role: 'user' | 'assistant', text: string): void {
    this.put(id, { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'text', text }] })
  }

  /** Retain completed tool calls. @param call - validated function-call fields. */
  call(call: { call_id: string; name: string; arguments: string }): void {
    this.put(`call:${call.call_id}`, { type: 'function_call', call_id: call.call_id, name: call.name, arguments: call.arguments })
  }

  /** Retain host-inserted context and tool receipts. @param event - recorded outbound provider event. */
  input(event: StsMessage): void {
    if (event.type !== 'conversation.item.create') return
    const item = event.item as StsMessage
    if (typeof item.id === 'string' && item.id.startsWith('voice-history-')) return
    if (item.type === 'function_call_output') this.put(`result:${String(item.call_id)}`, item)
    else if (item.type === 'message') this.put(`inserted:${++this.sequence}`, item)
  }

  /** Build silent context insertion commands; excludes incomplete tool exchanges.
   * @returns ordered text and tool items, with no response creation. */
  restore(): readonly StsMessage[] {
    const items = [...this.entries.values()]
    const calls = new Set(items.filter(item => item.type === 'function_call').map(item => item.call_id))
    const results = new Set(items.filter(item => item.type === 'function_call_output').map(item => item.call_id))
    return items.filter((item) => {
      if (item.type === 'function_call' || item.type === 'function_call_output') return calls.has(item.call_id) && results.has(item.call_id)
      const content = item.content as readonly { text?: string }[]
      return content.some(part => Boolean(part.text))
    }).map(item => ({ type: 'conversation.item.create', item: { ...item, id: `voice-history-${++this.sequence}` } }))
  }
}
