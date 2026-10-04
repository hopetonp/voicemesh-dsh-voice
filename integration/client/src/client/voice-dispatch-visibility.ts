/**
 * Determine whether the transcript bubble already represents a voice-owned coding request.
 * @param source - message source recorded by the Session.
 * @param transcriptHistory - whether the VoiceMesh transcript bubble is visible.
 * @returns whether Chat should omit the duplicate coding-request row.
 */
export function hideVoiceDispatch(source: unknown, transcriptHistory: boolean): boolean {
  return transcriptHistory && typeof source === 'object' && source !== null && 'kind' in source && source.kind === 'user' && 'rpcId' in source
    && typeof source.rpcId === 'string' && /^voice:[a-f0-9]{64}$/.test(source.rpcId)
}
