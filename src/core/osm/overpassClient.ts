// Free, no-API-key OSM data via the public Overpass API. Endpoints are
// parameters (not hardcoded) so a mirror or self-hosted instance can be
// swapped in later without touching any caller.
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

// A well-known public mirror. Confirmed in the field: one endpoint can be
// unreachable for a given client - anything from a firewall/ISP dropping
// packets to that specific host (PingSucceeded but TcpTestSucceeded:False)
// to it actively refusing the connection - while another connects fine,
// with no way to know in advance which. Both are raced in parallel (see
// queryOverpass) rather than tried strictly in order, so a dead endpoint
// costs nothing beyond the round's timeout instead of blocking the whole
// request behind it.
//
// A third mirror (overpass.osm.ch) was tried here briefly to cover the
// case of both of these being unreachable for one client at once - but it
// turned out to return a plausible-looking *empty* success response
// (valid JSON, zero elements) for a real, dense urban bbox that
// definitely has OSM data, rather than erroring - worse than not
// racing it at all, since queryOverpass has no way to tell "genuinely
// no data here" apart from "this mirror's data is incomplete for this
// region", and Promise.any happily accepts either as a win. Removed
// until a replacement mirror's coverage can actually be verified rather
// than assumed from its being publicly listed somewhere.
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

// The public Overpass instances enforce a small number of concurrent
// request "slots" per client (see the Overpass API usage policy) -
// independent of total request VOLUME, which the rest of this app already
// works hard to cut (fixed-grid tiling/caching, land-use request dedup,
// discarding superseded requests). A single pan into a brand-new area can
// still fire several distinct queries at once - multiple viewpoint tiles
// plus roads plus land-use - each racing both endpoints in parallel,
// easily landing more simultaneous connections on one instance than its
// slot limit allows and triggering an immediate 429, even though none of
// those queries is individually wasteful. This caps how many requests are
// actually in flight to any one endpoint at a time; anything beyond that
// queues instead of firing immediately, so a burst of "new area" queries
// spreads out over the endpoint's own slots rather than all landing in the
// same instant.
const MAX_CONCURRENT_PER_ENDPOINT = 2

class EndpointGate {
  private active = 0
  private readonly queue: (() => void)[] = []

  async run<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
    await this.acquire()
    try {
      if (signal.aborted) throw new DOMException('Superseded by a newer viewport request', 'AbortError')
      return await fn()
    } finally {
      this.release()
    }
  }

  private acquire(): Promise<void> {
    if (this.active < MAX_CONCURRENT_PER_ENDPOINT) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

// Module-scoped (not per-orchestrator-instance) so the limit is enforced
// across the whole app, matching how the endpoint's own slot limit works -
// a gate is created lazily per endpoint URL the first time it's used.
const endpointGates = new Map<string, EndpointGate>()

function gateFor(endpoint: string): EndpointGate {
  let gate = endpointGates.get(endpoint)
  if (!gate) {
    gate = new EndpointGate()
    endpointGates.set(endpoint, gate)
  }
  return gate
}

async function attemptEndpoint(
  endpoint: string,
  query: string,
  fetchImpl: FetchLike,
  signal: AbortSignal
): Promise<OverpassResponse> {
  return gateFor(endpoint).run(async () => {
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

    const parsed = (await response.json()) as OverpassResponse
    // A valid, successful response from a mirror with bad/incomplete data
    // for the queried region looks identical to a genuine "no results here"
    // - logging which endpoint actually answered (and how many elements it
    // returned) is the only way to tell those apart after the fact, and is
    // what would have made the overpass.osm.ch regression diagnosable in
    // one round instead of several - see the comment on FALLBACK_OVERPASS_ENDPOINT.
    console.log(`[overpassClient] ${endpoint} answered with ${parsed.elements.length} element(s)`)
    return parsed
  }, signal)
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
