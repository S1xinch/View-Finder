import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OVERPASS_ENDPOINT, queryOverpass } from './overpassClient'

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, statusText: init?.statusText })
}

describe('queryOverpass', () => {
  it('returns parsed JSON on a successful first attempt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }))
    const result = await queryOverpass('query', { fetchImpl })
    expect(result).toEqual({ elements: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('retries the same endpoint on a 504 before succeeding', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 504, statusText: 'Gateway Timeout' }))
      .mockResolvedValueOnce(jsonResponse({ elements: [] }))

    const result = await queryOverpass('query', { fetchImpl, endpoint: DEFAULT_OVERPASS_ENDPOINT, retryDelayMs: 0 })
    expect(result).toEqual({ elements: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe(DEFAULT_OVERPASS_ENDPOINT)
    expect(fetchImpl.mock.calls[1][0]).toBe(DEFAULT_OVERPASS_ENDPOINT)
  })

  it('falls back to the mirror endpoint after the primary exhausts its retries', async () => {
    const fetchImpl = vi.fn().mockImplementation((endpoint: string) => {
      if (endpoint === DEFAULT_OVERPASS_ENDPOINT) {
        return Promise.resolve(jsonResponse({}, { status: 503, statusText: 'Service Unavailable' }))
      }
      return Promise.resolve(jsonResponse({ elements: [] }))
    })

    const result = await queryOverpass('query', { fetchImpl, retryDelayMs: 0 })
    expect(result).toEqual({ elements: [] })
    // 2 failed attempts against the primary, then 1 successful attempt against the mirror
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[2][0]).not.toBe(DEFAULT_OVERPASS_ENDPOINT)
  })

  it('does not retry a non-retryable 4xx response, and throws once endpoints are exhausted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 400, statusText: 'Bad Request' }))

    await expect(queryOverpass('query', { fetchImpl, retryDelayMs: 0 })).rejects.toThrow('400')
    // One attempt per endpoint (2 endpoints), no retries within an endpoint since 400 isn't retryable
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('aborts immediately (without calling fetch) if the signal is already aborted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }))
    const controller = new AbortController()
    controller.abort()

    await expect(queryOverpass('query', { fetchImpl, signal: controller.signal })).rejects.toThrow(
      'Superseded'
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request when the signal fires mid-request', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation((_endpoint: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const promise = queryOverpass('query', { fetchImpl, signal: controller.signal, retryDelayMs: 0 })
    controller.abort()

    await expect(promise).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
