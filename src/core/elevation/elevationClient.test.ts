import { describe, expect, it, vi } from 'vitest'
import { MAX_LOCATIONS_PER_REQUEST, queryElevations } from './elevationClient'

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

  it('parses a successful response into ElevationSample[]', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 'OK',
        results: [
          { elevation: 1234.5, location: { lat: -33.7, lng: 150.3 } },
          { elevation: null, location: { lat: -33.71, lng: 150.31 } }
        ]
      })
    )

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

  it('sends all points as a single pipe-delimited request body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'OK', results: [] }))
    await queryElevations(
      [
        { lat: 1, lng: 2 },
        { lat: 3, lng: 4 }
      ],
      { fetchImpl }
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.locations).toBe('1,2|3,4')
  })

  it('throws for an HTTP error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 429, statusText: 'Too Many Requests' }))
    await expect(queryElevations([{ lat: 1, lng: 2 }], { fetchImpl })).rejects.toThrow('429')
  })

  it('throws when the API reports a non-OK status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'INVALID_REQUEST', error: 'bad locations' }))
    await expect(queryElevations([{ lat: 1, lng: 2 }], { fetchImpl })).rejects.toThrow('INVALID_REQUEST')
  })

  it('throws before calling fetch if given more points than the per-request limit', async () => {
    const fetchImpl = vi.fn()
    const points = Array.from({ length: MAX_LOCATIONS_PER_REQUEST + 1 }, (_, i) => ({ lat: i, lng: i }))
    await expect(queryElevations(points, { fetchImpl })).rejects.toThrow(String(MAX_LOCATIONS_PER_REQUEST))
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
