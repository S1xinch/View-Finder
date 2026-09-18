import { describe, expect, it, vi } from 'vitest'
import { queryRoute } from './osrmClient'

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, statusText: init?.statusText })
}

const FROM = { lat: -33.7, lng: 150.3 }
const TO = { lat: -33.71, lng: 150.32 }

const SAMPLE_OSRM_RESPONSE = {
  code: 'Ok',
  routes: [
    {
      distance: 4200,
      duration: 360,
      geometry: {
        type: 'LineString',
        coordinates: [
          [150.3, -33.7],
          [150.31, -33.705],
          [150.32, -33.71]
        ]
      },
      legs: [
        {
          steps: [
            { distance: 100, name: 'Main St', maneuver: { type: 'depart', location: [150.3, -33.7] } },
            { distance: 2000, name: 'Ridge Rd', maneuver: { type: 'turn', modifier: 'left', location: [150.31, -33.705] } },
            { distance: 2100, name: 'Ridge Rd', maneuver: { type: 'arrive', location: [150.32, -33.71] } }
          ]
        }
      ]
    }
  ]
}

describe('queryRoute', () => {
  it('parses a successful OSRM response into a RouteResult', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE_OSRM_RESPONSE))

    const result = await queryRoute(FROM, TO, { fetchImpl })

    expect(result.distanceMeters).toBe(4200)
    expect(result.durationSeconds).toBe(360)
    expect(result.coordinates).toEqual(SAMPLE_OSRM_RESPONSE.routes[0].geometry.coordinates)
    expect(result.steps).toEqual([
      { instruction: 'Head out', distanceMeters: 100, type: 'depart', modifier: undefined, location: [150.3, -33.7] },
      {
        instruction: 'Turn left onto Ridge Rd',
        distanceMeters: 2000,
        type: 'turn',
        modifier: 'left',
        location: [150.31, -33.705]
      },
      {
        instruction: 'You have arrived at your destination',
        distanceMeters: 2100,
        type: 'arrive',
        modifier: undefined,
        location: [150.32, -33.71]
      }
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toContain(`${FROM.lng},${FROM.lat}`)
    expect(url).toContain(`${TO.lng},${TO.lat}`)
  })

  it('throws when OSRM reports no route (e.g. no road between the points)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 'NoRoute', routes: [] }))

    await expect(queryRoute(FROM, TO, { fetchImpl })).rejects.toThrow('NoRoute')
  })

  it('throws on a non-OK HTTP response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 500, statusText: 'Server Error' }))

    await expect(queryRoute(FROM, TO, { fetchImpl })).rejects.toThrow('500')
  })

  it('propagates an abort from the supplied signal', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const promise = queryRoute(FROM, TO, { fetchImpl, signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toThrow()
  })
})
