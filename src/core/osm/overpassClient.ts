// Free, no-API-key OSM data via the public Overpass API. The endpoint is a
// parameter (not hardcoded) so a mirror or self-hosted instance can be
// swapped in later without touching any caller.
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

// Overpass's own [timeout:25] in the query only bounds how long the SERVER
// spends running the query - it does nothing if the connection itself never
// completes (e.g. a firewall silently drops the packets instead of
// rejecting the connection). Without a client-side timeout that hangs the
// request forever with no error, which looks identical to "still loading"
// from the UI. This bounds it explicitly.
const REQUEST_TIMEOUT_MS = 20_000

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

export interface OverpassResponse {
  elements: OverpassElement[]
}

// The caller supplies the fetch implementation (main process injects
// Electron's net.fetch, which uses Chromium's network stack and so behaves
// consistently with the renderer's already-working map tile requests,
// rather than Node's own fetch/undici, which doesn't pick up OS-level
// proxy/firewall configuration the same way). Defaults to the global fetch
// for plain Node contexts like unit tests.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function queryOverpass(
  query: string,
  options?: { endpoint?: string; fetchImpl?: FetchLike }
): Promise<OverpassResponse> {
  const endpoint = options?.endpoint ?? DEFAULT_OVERPASS_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: query,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as OverpassResponse
}
