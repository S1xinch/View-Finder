import { describe, expect, it, vi } from 'vitest'
import { queryElevations } from './elevationClient'

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, statusText: init?.statusText })
}

describe('queryElevations', () => {
  it('returns [] without calling fetch for an empty point list', async () => {
    const fetchImpl = vi.fn()
    const result = await queryElevations([], { fetchImpl })
    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('pairs each returned elevation with its input point, in order', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elevation: [1234.5, null] }))

    const result = await queryElevations(
      [
        { lat: -33.7, lng: 150.3 },
        { lat: -33.71, lng: 150.31 }
      ],
      { fetchImpl }
    )

    expect(result).toEqual([
      { lat: -33.7, lng: 150.3, elevationMeters: 1234.5 },
      { lat: -33.71, lng: 150.31, elevationMeters: null }
    ])
  })

  it('sends all points in one plain GET (no custom headers, so no CORS preflight)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elevation: [1, 2] }))
    await queryElevations(
      [
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 }
      ],
      { fetchImpl }
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    const params = new URL(url as string).searchParams
    expect(params.get('latitude')).toBe('1.00000,3.00000')
    expect(params.get('longitude')).toBe('2.00000,4.00000')
    expect(init.method).toBeUndefined()
    expect(init.headers).toBeUndefined()
  })

  it('throws with the API reason for an HTTP error response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: true, reason: 'Latitude out of range' }, { status: 400, statusText: 'Bad Request' }))
    await expect(queryElevations([{ lat: 1, lng: 2 }], { fetchImpl })).rejects.toThrow('Latitude out of range')
  })

  it('throws for a rate-limited response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 429, statusText: 'Too Many Requests' }))
    await expect(queryElevations([{ lat: 1, lng: 2 }], { fetchImpl })).rejects.toThrow('429')
  })

  it('throws when the response has the wrong number of values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elevation: [1] }))
    await expect(
      queryElevations(
        [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 }
        ],
        { fetchImpl }
      )
    ).rejects.toThrow('1 value(s) for 2 point(s)')
  })

  it('batches >100 points into separate requests', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const count = new URL(url).searchParams.get('latitude')!.split(',').length
      return Promise.resolve(jsonResponse({ elevation: Array.from({ length: count }, (_, i) => 1000 + i) }))
    })
    const points = Array.from({ length: 110 }, (_, i) => ({ lat: i / 10, lng: i / 10 }))
    const result = await queryElevations(points, { fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(110)
    expect(result[105]).toEqual({ lat: 10.5, lng: 10.5, elevationMeters: 1005 })
  })
})
