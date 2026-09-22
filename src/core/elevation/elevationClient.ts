import type { ElevationSample, LatLng } from './types'

// Free, no-API-key elevation lookups via Open-Meteo (Copernicus 90m DEM,
// worldwide). Chosen over OpenTopoData's public instance because that one
// sends no CORS headers, so every browser blocked it and the website build
// never got elevation data at all - Open-Meteo allows cross-origin GETs,
// which covers both the website and the desktop app with one provider.
export const DEFAULT_ELEVATION_ENDPOINT = 'https://api.open-meteo.com/v1/elevation'

// Open-Meteo accepts up to 100 coordinates per request - prominence.ts's
// grid is sized to fit exactly one.
export const MAX_LOCATIONS_PER_REQUEST = 100

const REQUEST_TIMEOUT_MS = 20_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface OpenMeteoElevationResponse {
  elevation?: (number | null)[]
  error?: boolean
  reason?: string
}

export async function queryElevations(
  points: LatLng[],
  options?: { endpoint?: string; fetchImpl?: FetchLike; signal?: AbortSignal }
): Promise<ElevationSample[]> {
  if (points.length === 0) return []

  if (points.length > MAX_LOCATIONS_PER_REQUEST) {
    const batches: LatLng[][] = []
    for (let i = 0; i < points.length; i += MAX_LOCATIONS_PER_REQUEST) {
      batches.push(points.slice(i, i + MAX_LOCATIONS_PER_REQUEST))
    }
    const results = await Promise.all(batches.map((batch) => queryElevations(batch, options)))
    return results.flat()
  }

  const endpoint = options?.endpoint ?? DEFAULT_ELEVATION_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch
  const supersededSignal = options?.signal
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = supersededSignal ? AbortSignal.any([timeoutSignal, supersededSignal]) : timeoutSignal

  const latitudes = points.map((p) => p.lat.toFixed(5)).join(',')
  const longitudes = points.map((p) => p.lng.toFixed(5)).join(',')

  // A plain GET with no custom headers is a CORS "simple request" - no
  // preflight for the browser build to fail on.
  const response = await fetchImpl(`${endpoint}?latitude=${latitudes}&longitude=${longitudes}`, { signal })
  const data = (await response.json().catch(() => ({}))) as OpenMeteoElevationResponse

  if (!response.ok || data.error) {
    throw new Error(
      `Elevation request failed: ${response.status} ${response.statusText}${data.reason ? ` (${data.reason})` : ''}`
    )
  }

  const elevations = data.elevation
  if (!elevations || elevations.length !== points.length) {
    throw new Error(`Elevation response had ${elevations?.length ?? 0} value(s) for ${points.length} point(s)`)
  }

  return points.map((p, i) => {
    const e = elevations[i]
    return { lat: p.lat, lng: p.lng, elevationMeters: typeof e === 'number' && Number.isFinite(e) ? e : null }
  })
}
