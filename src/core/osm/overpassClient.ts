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

// The caller may supply a different fetch implementation (e.g. for tests).
// Defaults to the global fetch.
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

// Overpass's usage policy (https://wiki.openstreetmap.org/wiki/Overpass_API)
// asks clients to identify themselves via User-Agent; a missing/generic one
// (or a missing Accept header) has been observed to get a 406 Not
// Acceptable from the public instance's front end.
const USER_AGENT = 'ViewFinder/1.0 (+https://github.com/s1xinch/view-finder)'

export async function queryOverpass(
  query: string,
  options?: { endpoint?: string; fetchImpl?: FetchLike }
): Promise<OverpassResponse> {
  const endpoint = options?.endpoint ?? DEFAULT_OVERPASS_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    },
    body: query,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as OverpassResponse
}
