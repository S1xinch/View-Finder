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

  it('batches >100 points into parallel requests', async () => {
    // A fresh Response per call - parallel batches each read their own body,
    // and a Response's body can only be consumed once.
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const locations = (JSON.parse(init.body as string).locations as string).split('|')
      return Promise.resolve(
        jsonResponse({
          status: 'OK',
          results: locations.map((loc) => {
            const [lat, lng] = loc.split(',').map(Number)
            return { elevation: 1000 + lat, location: { lat, lng } }
          })
        })
      )
    })
    const points = Array.from({ length: 110 }, (_, i) => ({ lat: i, lng: i }))
    const result = await queryElevations(points, { fetchImpl })

    // Should make 2 requests: one for first 100, one for remaining 10
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(110)
  })
})
