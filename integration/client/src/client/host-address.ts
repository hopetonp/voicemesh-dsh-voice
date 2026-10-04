/** The address of the host this page talks to, for routes that must not assume a shared origin. */

/**
 * Read the host address the runtime hands this page.
 *
 * In a browser the page and its host share an origin, so the document answers for both. The desktop
 * shell serves the page from its own application scheme while the host answers on loopback, so the
 * transport the runtime injects is the only address that names the host; without it every socket
 * built below would point at the page itself rather than at the host behind it.
 * @returns the base URL host routes resolve against.
 */
export function hostBaseUrl(): URL {
  const injected = (globalThis as { __DSH_TRANSPORT__?: { streamBaseUrl?: string } }).__DSH_TRANSPORT__?.streamBaseUrl
  if (injected !== undefined && injected !== '') return new URL(injected)
  // Without an injected transport the document answers. A non-browser runtime — the client face is
  // also driven from node test environments — has no document, so the loopback origin stands in
  // rather than throwing before any request is made.
  return typeof document === 'undefined' ? new URL('http://127.0.0.1') : new URL(document.baseURI)
}

/**
 * Build the WebSocket address of one host route.
 * @param route - absolute host route, such as `/voice-sts/live`.
 * @param query - already-encoded query string, leading `?` included, when the route needs one.
 * @returns the socket URL, on the scheme matching the host's own protocol.
 */
export function hostWebSocketUrl(route: string, query = ''): string {
  const base = hostBaseUrl()
  const scheme = base.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${base.host}${route}${query}`
}
