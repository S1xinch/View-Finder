import type { ElevationSample, LatLng } from './types'

// Free, no-API-key elevation lookups via OpenTopoData's public demo
// instance (self-hostable later if the free tier's modest rate limit
// becomes a problem: https://www.opentopodata.org/). srtm90m is a
// reasonable global default (90m resolution, worldwide coverage between
// ~60N and 56S).
export const DEFAULT_OPENTOPODATA_ENDPOINT = 'https://api.opentopodata.org/v1/srtm90m'

// The public demo API caps requests at 100 locations each - our grid size
// in prominence.ts is chosen to fit exactly one request.
export const MAX_LOCATIONS_PER_REQUEST = 100

const REQUEST_TIMEOUT_MS = 20_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface OpenTopoDataResult {
  elevation: number | null
  location: { lat: number; lng: number }
}

interface OpenTopoDataResponse {
  results?: OpenTopoDataResult[]
  status: string
  error?: string
}

export async function queryElevations(
  points: LatLng[],
  options?: { endpoint?: string; fetchImpl?: FetchLike; signal?: AbortSignal }
): Promise<ElevationSample[]> {
  if (points.length === 0) return []
  if (points.length > MAX_LOCATIONS_PER_REQUEST) {
    throw new Error(`queryElevations: ${points.length} points exceeds the ${MAX_LOCATIONS_PER_REQUEST}-point request limit`)
  }

  const endpoint = options?.endpoint ?? DEFAULT_OPENTOPODATA_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch
  const supersededSignal = options?.signal
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = supersededSignal ? AbortSignal.any([timeoutSignal, supersededSignal]) : timeoutSignal

  const locations = points.map((p) => `${p.lat},${p.lng}`).join('|')

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations }),
    signal
  })

  if (!response.ok) {
    throw new Error(`OpenTopoData request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as OpenTopoDataResponse

  if (data.status !== 'OK' || !data.results) {
    throw new Error(`OpenTopoData returned an error status: ${data.status}${data.error ? ` (${data.error})` : ''}`)
  }

  return data.results.map((result) => ({
    lat: result.location.lat,
    lng: result.location.lng,
    elevationMeters: result.elevation
  }))
}
