import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERPASS_ENDPOINT, queryOverpass } from './overpassClient'

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, statusText: init?.statusText })
}

describe('queryOverpass', () => {
  it('returns parsed JSON on a successful first attempt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }))
    const result = await queryOverpass('query', { fetchImpl, endpoint: DEFAULT_OVERPASS_ENDPOINT })
    expect(result).toEqual({ elements: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('races both endpoints and returns whichever succeeds, even if the other is unreachable', async () => {
    // Simulates the real-world case: the primary is silently unreachable
    // (its fetch never settles within the request) while the mirror
    // answers immediately - the mirror's result should win without waiting
    // out the primary.
    const fetchImpl = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint === DEFAULT_OVERPASS_ENDPOINT) {
        return new Promise(() => {
          /* never resolves - simulates a black-holed connection */
        })
      }
      return Promise.resolve(jsonResponse({ elements: [] }))
    })

    const result = await queryOverpass('query', { fetchImpl })
    expect(result).toEqual({ elements: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws once every endpoint fails, without a second retry round', async () => {
    // A second full round used to double the worst-case wait on a genuine
    // failure without reliably helping in practice - see the comment on
    // MAX_ATTEMPTS in overpassClient.ts. One round races every endpoint in
    // parallel; if all of them fail, it gives up rather than trying again.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500, statusText: 'Server Error' }))

    await expect(queryOverpass('query', { fetchImpl, retryDelayMs: 0 })).rejects.toThrow()
    // 2 endpoints x 1 round
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('aborts immediately (without calling fetch) if the signal is already aborted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }))
    const controller = new AbortController()
    controller.abort()

    await expect(queryOverpass('query', { fetchImpl, signal: controller.signal })).rejects.toThrow('Superseded')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('aborts in-flight requests when the signal fires mid-request', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation((_endpoint: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const promise = queryOverpass('query', { fetchImpl, signal: controller.signal, retryDelayMs: 0 })
    // Wait for both endpoint requests to genuinely be in flight before
    // aborting - otherwise this races the concurrency gate's own "already
    // superseded" pre-check (see EndpointGate.run in overpassClient.ts),
    // which can legitimately short-circuit before ever calling fetchImpl
    // if the abort happens in the same tick the request was started.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    controller.abort()

    await expect(promise).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('caps concurrent requests to the same endpoint, queuing the rest rather than firing them all at once', async () => {
    // Real-world motivation: the public Overpass instances enforce a small
    // per-client concurrent-slot limit, independent of total request
    // volume - a single pan into a brand-new area can fire several
    // distinct queries at once (multiple viewpoint tiles + roads +
    // land-use), and without a cap here they'd all hit the same endpoint
    // simultaneously and trip an immediate 429 regardless of how well
    // volume is otherwise controlled.
    // A dedicated fake endpoint, not DEFAULT_OVERPASS_ENDPOINT/
    // FALLBACK_OVERPASS_ENDPOINT - the gate is keyed per endpoint URL and
    // lives at module scope for the lifetime of the test process, so
    // reusing a real endpoint here could pick up a slot left held by an
    // earlier test's deliberately-never-resolving mock (e.g. the
    // "black-holed connection" case above) rather than reflecting this
    // test's own behavior in isolation.
    const testEndpoint = 'https://test-endpoint.example/interpreter'
    let active = 0
    let peakActive = 0
    const resolvers: (() => void)[] = []
    const fetchImpl = vi.fn().mockImplementation(() => {
      active++
      peakActive = Math.max(peakActive, active)
      return new Promise<Response>((resolve) => {
        resolvers.push(() => {
          active--
          resolve(jsonResponse({ elements: [] }))
        })
      })
    })

    const calls = [0, 1, 2, 3].map(() => queryOverpass('query', { fetchImpl, endpoint: testEndpoint }))

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    expect(active).toBe(2)

    resolvers[0]()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3))
    resolvers[1]()
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4))
    resolvers[2]()
    resolvers[3]()

    await Promise.all(calls)
    expect(peakActive).toBe(2)
  })
})
