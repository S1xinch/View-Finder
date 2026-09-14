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

  it('retries a full round if every endpoint fails, then succeeds', async () => {
    let callCount = 0
    const fetchImpl = vi.fn().mockImplementation(() => {
      callCount++
      // Both endpoints fail on round 1 (calls 1-2), both succeed on round 2 (calls 3-4)
      if (callCount <= 2) {
        return Promise.resolve(jsonResponse({}, { status: 503, statusText: 'Service Unavailable' }))
      }
      return Promise.resolve(jsonResponse({ elements: [] }))
    })

    const result = await queryOverpass('query', { fetchImpl, retryDelayMs: 0 })
    expect(result).toEqual({ elements: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('throws once every endpoint fails on every retry round', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500, statusText: 'Server Error' }))

    await expect(queryOverpass('query', { fetchImpl, retryDelayMs: 0 })).rejects.toThrow()
    // 2 endpoints x 2 rounds
    expect(fetchImpl).toHaveBeenCalledTimes(4)
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
    controller.abort()

    await expect(promise).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
