/**
 * Select the spoken request that the coding Session may receive.
 * @param lines - chronological Live transcript lines.
 * @returns the latest non-empty user line.
 */
export function latestLiveUserRequest(lines: readonly { readonly role: string, readonly text: string }[]): string {
  const request = lines.findLast(line => line.role === 'user' && line.text.trim() !== '')?.text.trim()
  if (request === undefined || request === '') throw new Error('Live delegation has no user request')
  return request
}
