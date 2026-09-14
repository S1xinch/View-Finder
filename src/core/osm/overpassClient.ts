// Free, no-API-key OSM data via the public Overpass API. Endpoints are
// parameters (not hardcoded) so a mirror or self-hosted instance can be
// swapped in later without touching any caller.
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

// A well-known public mirror. Confirmed in the field: one endpoint can be
// silently unreachable (a firewall/ISP dropping packets to that specific
// host rather than actively rejecting the connection - PingSucceeded but
// TcpTestSucceeded:False) while the other connects fine, with no way to
// know in advance which. Both are raced in parallel (see queryOverpass)
// rather than tried strictly in order, so a dead endpoint costs nothing
// beyond the round's timeout instead of blocking the whole request behind
// it.
const FALLBACK_OVERPASS_ENDPOINT = 'https://overpass.kumi.systems/api/interpreter'

// Overpass's own [timeout:25] in the query only bounds how long the SERVER
// spends running the query - it does nothing if the connection itself never
// completes (e.g. a firewall silently drops the packets instead of
// rejecting the connection). Without a client-side timeout that hangs the
// request forever with no error, which looks identical to "still loading"
// from the UI. This bounds it explicitly.
const REQUEST_TIMEOUT_MS = 20_000

// A single round already races every configured endpoint in parallel (see
// queryOverpass below), so this isn't "give up after one try" - it's "give
// up after one race between all endpoints". A second full retry round used
// to double the worst-case wait (up to ~40s) on a genuine failure without
// reliably helping in practice; getViewpoints() in coolSpotService.ts
// already falls back gracefully to computed-peaks-only when OSM fails, so
// failing faster into that fallback is the better tradeoff.
const MAX_ATTEMPTS = 1
const RETRY_DELAY_MS = 1_500

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
  // Present on way/relation elements when the query uses `out geom;`
  // instead of `out body;` - gives the actual node coordinates inline
  // without a separate resolution step, which is what road/land-use
  // queries need to build LineStrings/polygons.
  geometry?: { lat: number; lon: number }[]
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function attemptEndpoint(
  endpoint: string,
  query: string,
  fetchImpl: FetchLike,
  signal: AbortSignal
): Promise<OverpassResponse> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    },
    body: query,
    signal
  })

  if (!response.ok) {
    throw new Error(`Overpass request failed (${endpoint}): ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as OverpassResponse
}

export async function queryOverpass(
  query: string,
  options?: { endpoint?: string; fetchImpl?: FetchLike; retryDelayMs?: number; signal?: AbortSignal }
): Promise<OverpassResponse> {
  const endpoints = options?.endpoint ? [options.endpoint] : [DEFAULT_OVERPASS_ENDPOINT, FALLBACK_OVERPASS_ENDPOINT]
  const fetchImpl = options?.fetchImpl ?? fetch
  const retryDelayMs = options?.retryDelayMs ?? RETRY_DELAY_MS
  const supersededSignal = options?.signal
  let lastError: unknown = new Error('Overpass request failed: no endpoints configured')

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (supersededSignal?.aborted) {
      throw new DOMException('Superseded by a newer viewport request', 'AbortError')
    }

    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = supersededSignal ? AbortSignal.any([timeoutSignal, supersededSignal]) : timeoutSignal

    try {
      // Whichever endpoint responds successfully first wins; a losing
      // endpoint (including one that's silently unreachable) just keeps
      // running in the background until its own signal fires, but nothing
      // waits on it.
      return await Promise.any(endpoints.map((endpoint) => attemptEndpoint(endpoint, query, fetchImpl, signal)))
    } catch (error) {
      lastError = error
      if (error instanceof AggregateError) {
        error.errors.forEach((individual: unknown, i: number) => {
          console.warn(`[overpassClient] ${endpoints[i]} attempt ${attempt} -> ${String(individual)}`)
        })
      } else {
        console.warn(`[overpassClient] attempt ${attempt} -> ${String(error)}`)
      }
    }

    if (attempt < MAX_ATTEMPTS) await delay(retryDelayMs)
  }

  throw lastError
}
