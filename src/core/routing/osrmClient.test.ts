import { describe, expect, it, vi } from 'vitest'
import { approachCandidates, findBestApproach, queryRoute, routeToSpot } from './osrmClient'

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

// A table response for [origin, ...approachCandidates(TO)]: every candidate
// snaps to `location` with drive `duration`, except the overrides.
function tableResponse(overrides: Record<number, { location: [number, number]; duration: number }>) {
  const count = approachCandidates(TO).length + 1
  const destinations = Array.from({ length: count }, (_, i) => ({
    location: overrides[i]?.location ?? ([TO.lng + 0.03, TO.lat] as [number, number])
  }))
  const durations = [Array.from({ length: count }, (_, i) => (i === 0 ? 0 : (overrides[i]?.duration ?? 1500)))]
  return { code: 'Ok', durations, destinations }
}

describe('findBestApproach', () => {
  it('tries the spot plus a ring of points around it', () => {
    expect(approachCandidates(TO)).toHaveLength(25)
    expect(approachCandidates(TO)[0]).toEqual(TO)
  })

  it('prefers a quick drive with a short walk over a snap across the valley', async () => {
    // Index 1 = the spot itself: OSRM snapped it to a road ~2.8 km away but
    // "only" 600s of driving. Index 5: a road 100 m from the spot, 900s away.
    const near: [number, number] = [TO.lng + 0.001, TO.lat]
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(tableResponse({ 1: { location: [TO.lng + 0.03, TO.lat], duration: 600 }, 5: { location: near, duration: 900 } }))
    )

    const approach = await findBestApproach(FROM, TO, { fetchImpl })

    expect(approach).toEqual({ lat: near[1], lng: near[0] })
    expect(fetchImpl.mock.calls[0][0]).toContain('/table/v1/driving/')
  })

  it('falls back to the spot itself when the table request fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 503, statusText: 'Unavailable' }))
    await expect(findBestApproach(FROM, TO, { fetchImpl })).resolves.toEqual(TO)
  })
})

describe('routeToSpot', () => {
  it('routes to the chosen approach point', async () => {
    const near: [number, number] = [TO.lng + 0.001, TO.lat]
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(tableResponse({ 5: { location: near, duration: 300 } })))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_OSRM_RESPONSE))

    const result = await routeToSpot(FROM, TO, { fetchImpl })

    expect(result.distanceMeters).toBe(4200)
    expect(fetchImpl.mock.calls[1][0]).toContain(`${near[0]},${near[1]}`)
  })
})
