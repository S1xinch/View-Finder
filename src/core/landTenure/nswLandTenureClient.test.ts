import { describe, expect, it, vi } from 'vitest'
import { queryTenureClass } from './nswLandTenureClient'

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, statusText: init?.statusText })
}

const POINT = { lat: -32.25, lng: 148.6 }

describe('queryTenureClass', () => {
  it('returns the tenure class from a successful identify response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [{ layerId: 3, attributes: { 'Raster.TenureClas': 'Private' } }]
      })
    )

    const result = await queryTenureClass(POINT, { fetchImpl })

    expect(result).toBe('Private')
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toContain(`${POINT.lng},${POINT.lat}`)
    expect(url).toContain('geometryType=esriGeometryPoint')
  })

  it('returns null when the point has no classification (e.g. outside NSW)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }))

    const result = await queryTenureClass(POINT, { fetchImpl })

    expect(result).toBeNull()
  })

  it('throws on a non-OK HTTP response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500, statusText: 'Server Error' }))

    await expect(queryTenureClass(POINT, { fetchImpl })).rejects.toThrow('500')
  })

  it('propagates an abort from the supplied signal', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const promise = queryTenureClass(POINT, { fetchImpl, signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toThrow()
  })
})
