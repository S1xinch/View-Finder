import { describe, expect, it, vi } from 'vitest'
import { searchPlaces } from './nominatimClient'

function jsonResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  return new Response(JSON.stringify(body), { status: init?.status ?? 200, statusText: init?.statusText })
}

const SAMPLE_NOMINATIM_RESPONSE = [
  {
    place_id: 12345,
    display_name: 'Bredbo, Snowy Monaro Regional Council, New South Wales, Australia',
    lat: '-35.9520',
    lon: '149.1573',
    boundingbox: ['-35.97', '-35.93', '149.14', '149.17']
  }
]

describe('searchPlaces', () => {
  it('parses a successful Nominatim response into PlaceResults', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(SAMPLE_NOMINATIM_RESPONSE))

    const results = await searchPlaces('Bredbo', { fetchImpl })

    expect(results).toEqual([
      {
        id: '12345',
        name: 'Bredbo, Snowy Monaro Regional Council, New South Wales, Australia',
        lat: -35.952,
        lng: 149.1573,
        boundingBox: { south: -35.97, north: -35.93, west: 149.14, east: 149.17 }
      }
    ])
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toContain('q=Bredbo')
    expect(url).toContain('format=json')
  })

  it('returns an empty array without making a request for a blank query', async () => {
    const fetchImpl = vi.fn()

    const results = await searchPlaces('   ', { fetchImpl })

    expect(results).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('omits boundingBox when Nominatim does not provide one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse([{ place_id: 1, display_name: 'Somewhere', lat: '0', lon: '0' }])
    )

    const results = await searchPlaces('Somewhere', { fetchImpl })

    expect(results[0].boundingBox).toBeUndefined()
  })

  it('throws on a non-OK HTTP response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([], { status: 500, statusText: 'Server Error' }))

    await expect(searchPlaces('anywhere', { fetchImpl })).rejects.toThrow('500')
  })

  it('propagates an abort from the supplied signal', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })

    const promise = searchPlaces('anywhere', { fetchImpl, signal: controller.signal })
    controller.abort()

    await expect(promise).rejects.toThrow()
  })
})
