// Free, no-API-key place search via OpenStreetMap's own Nominatim
// instance - the geocoding counterpart to Overpass elsewhere in core/,
// same "free/open stack, no signup" philosophy. Self-hostable later if
// this public instance's fair-use limits become a problem, without any
// caller-side changes.
export const DEFAULT_NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESULTS = 6

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// asks for a distinguishing User-Agent, or for browser-based apps a valid
// Referer identifying the site instead - the browser already sends its
// own Referer automatically, satisfying that for the website build. This
// header is for the desktop build's net.fetch (not subject to a page
// fetch()'s forbidden-header restriction the way this would be in a
// browser - it's silently dropped there instead, same as
// overpassClient.ts's own User-Agent, and just as harmless since Referer
// covers the browser case).
const USER_AGENT = 'ViewFinder/1.0 (+https://github.com/s1xinch/view-finder)'

interface NominatimResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
  // [south, north, west, east] as strings, present on essentially every
  // real result - optional here only to be defensive about the exact
  // response shape.
  boundingbox?: [string, string, string, string]
}

export interface PlaceBoundingBox {
  south: number
  north: number
  west: number
  east: number
}

export interface PlaceResult {
  id: string
  name: string
  lat: number
  lng: number
  boundingBox?: PlaceBoundingBox
}

export interface SearchPlacesOptions {
  endpoint?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export async function searchPlaces(query: string, options?: SearchPlacesOptions): Promise<PlaceResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const endpoint = options?.endpoint ?? DEFAULT_NOMINATIM_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch
  const supersededSignal = options?.signal
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = supersededSignal ? AbortSignal.any([timeoutSignal, supersededSignal]) : timeoutSignal

  const url = `${endpoint}?q=${encodeURIComponent(trimmed)}&format=json&limit=${MAX_RESULTS}`

  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal
  })

  if (!response.ok) {
    throw new Error(`Nominatim request failed: ${response.status} ${response.statusText}`)
  }

  const results = (await response.json()) as NominatimResult[]

  return results.map((result) => {
    const [south, north, west, east] = result.boundingbox ?? []
    return {
      id: String(result.place_id),
      name: result.display_name,
      lat: Number.parseFloat(result.lat),
      lng: Number.parseFloat(result.lon),
      boundingBox:
        south && north && west && east
          ? {
              south: Number.parseFloat(south),
              north: Number.parseFloat(north),
              west: Number.parseFloat(west),
              east: Number.parseFloat(east)
            }
          : undefined
    }
  })
}
