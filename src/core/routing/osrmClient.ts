import type { LatLng, RouteResult, RouteStep } from './types'
import { haversineDistanceMeters } from '../geo/units'

// Free, no-API-key driving directions via OSRM's public demo server. Same
// "free/open stack, no signup" philosophy as Overpass/elevation
// elsewhere in core/ - self-hostable later if this demo instance's fair-use
// limits become a problem, without any caller-side changes.
export const DEFAULT_OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving'

const REQUEST_TIMEOUT_MS = 15_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface OsrmManeuver {
  type: string
  modifier?: string
  location: [number, number]
}

interface OsrmStep {
  distance: number
  name: string
  maneuver: OsrmManeuver
}

interface OsrmLeg {
  steps: OsrmStep[]
}

interface OsrmRoute {
  distance: number
  duration: number
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  legs: OsrmLeg[]
}

interface OsrmResponse {
  code: string
  routes: OsrmRoute[]
  message?: string
}

// OSRM's `steps` output gives a maneuver type/modifier and a street name,
// not a ready-made instruction sentence (that's normally the job of a
// separate text-instructions layer) - this is a small, deliberately simple
// mapping covering the common maneuver types, not a full localization
// engine.
function describeStep(step: OsrmStep): string {
  const road = step.name || 'the road'
  const modifier = step.maneuver.modifier ? `${step.maneuver.modifier} ` : ''

  switch (step.maneuver.type) {
    case 'depart':
      return 'Head out'
    case 'arrive':
      return 'You have arrived at your destination'
    case 'turn':
    case 'end of road':
      return `Turn ${modifier}onto ${road}`
    case 'fork':
      return `Keep ${modifier}at the fork onto ${road}`
    case 'merge':
      return `Merge onto ${road}`
    case 'on ramp':
      return `Take the ramp onto ${road}`
    case 'off ramp':
      return `Take the exit onto ${road}`
    case 'roundabout':
    case 'rotary':
      return `Enter the roundabout and take the exit onto ${road}`
    case 'new name':
    case 'continue':
      return `Continue onto ${road}`
    default:
      return `Continue onto ${road}`
  }
}

export interface QueryRouteOptions {
  endpoint?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

export async function queryRoute(from: LatLng, to: LatLng, options?: QueryRouteOptions): Promise<RouteResult> {
  const endpoint = options?.endpoint ?? DEFAULT_OSRM_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch
  const supersededSignal = options?.signal
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = supersededSignal ? AbortSignal.any([timeoutSignal, supersededSignal]) : timeoutSignal

  const url = `${endpoint}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=2`

  // Accept is on the CORS "safelisted" header list, so this stays a
  // simple request with no preflight - unlike overpassClient.ts's
  // User-Agent header (fine there since Overpass's CORS config happens to
  // allow it), OSRM's public demo server's CORS preflight response
  // doesn't include User-Agent in Access-Control-Allow-Headers, so
  // sending it here made every browser (website) request to OSRM fail
  // outright before it left the browser - surfaced as a generic "Load
  // failed" (Safari) / "Failed to fetch" (Chrome) with no useful detail,
  // while working fine from Electron's net.fetch (a main-process fetch,
  // not subject to page-level CORS at all).
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal
  })

  if (!response.ok) {
    throw new Error(`OSRM request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as OsrmResponse

  if (data.code !== 'Ok' || data.routes.length === 0) {
    throw new Error(`OSRM returned no route: ${data.code}${data.message ? ` (${data.message})` : ''}`)
  }

  function convertRoute(osrmRoute: OsrmRoute) {
    const steps: RouteStep[] = osrmRoute.legs.flatMap((leg) =>
      leg.steps.map((step) => ({
        instruction: describeStep(step),
        distanceMeters: step.distance,
        type: step.maneuver.type,
        modifier: step.maneuver.modifier,
        location: step.maneuver.location
      }))
    )
    return {
      coordinates: osrmRoute.geometry.coordinates,
      distanceMeters: osrmRoute.distance,
      durationSeconds: osrmRoute.duration,
      steps
    }
  }

  const primaryRoute = convertRoute(data.routes[0])
  const alternatives = data.routes.slice(1).map(convertRoute)

  return {
    ...primaryRoute,
    alternatives: alternatives.length > 0 ? alternatives : undefined
  }
}

export const DEFAULT_OSRM_TABLE_ENDPOINT = 'https://router.project-osrm.org/table/v1/driving'

// OSRM snaps a destination to the nearest road in its *connected* car
// network - skipping nearer isolated/gated pieces - which for a lookout on
// a cliff edge is often a road across the valley: a long drive to a spot a
// short drive from a road a little further away. Scoring a ring of
// candidate approach points by drive time + walking time (one /table
// request) picks the approach a person would actually use.
const APPROACH_RADII_M = [300, 800, 1600]
const APPROACH_BEARINGS = 8
const WALK_SPEED_MPS = 1.2
// A second of walking is worth avoiding 3 seconds of extra driving.
const WALK_PENALTY = 3

interface OsrmTableResponse {
  code: string
  durations?: (number | null)[][]
  destinations?: { location: [number, number] }[]
}

function offsetPoint(p: LatLng, meters: number, bearingDeg: number): LatLng {
  const b = (bearingDeg * Math.PI) / 180
  return {
    lat: p.lat + (meters * Math.cos(b)) / 111_320,
    lng: p.lng + (meters * Math.sin(b)) / (111_320 * Math.cos((p.lat * Math.PI) / 180))
  }
}

export function approachCandidates(to: LatLng): LatLng[] {
  const points = [to]
  for (const radius of APPROACH_RADII_M) {
    for (let i = 0; i < APPROACH_BEARINGS; i++) points.push(offsetPoint(to, radius, (360 / APPROACH_BEARINGS) * i))
  }
  return points
}

// Where to point the route at. Falls back to the spot itself (plain OSRM
// snapping, the old behaviour) if the table request fails for any reason
// other than being superseded.
export async function findBestApproach(
  from: LatLng,
  to: LatLng,
  options?: QueryRouteOptions & { tableEndpoint?: string }
): Promise<LatLng> {
  const endpoint = options?.tableEndpoint ?? DEFAULT_OSRM_TABLE_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options?.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal

  const candidates = approachCandidates(to)
  const coords = [from, ...candidates].map((p) => `${p.lng},${p.lat}`).join(';')

  try {
    const response = await fetchImpl(`${endpoint}/${coords}?sources=0&annotations=duration`, {
      headers: { Accept: 'application/json' },
      signal
    })
    if (!response.ok) return to
    const data = (await response.json()) as OsrmTableResponse
    const durations = data.durations?.[0]
    if (data.code !== 'Ok' || !durations || !data.destinations) return to

    let best: { score: number; point: LatLng } | null = null
    for (let i = 1; i < data.destinations.length; i++) {
      const duration = durations[i]
      if (duration == null) continue
      const [lng, lat] = data.destinations[i].location
      const point = { lat, lng }
      const score = duration + (haversineDistanceMeters(point, to) / WALK_SPEED_MPS) * WALK_PENALTY
      if (!best || score < best.score) best = { score, point }
    }
    return best?.point ?? to
  } catch (error) {
    if (options?.signal?.aborted) throw error
    return to
  }
}

// What callers use for "directions to this spot": the route ends at the
// best road approach, and the UI draws the remaining walk to the spot.
export async function routeToSpot(from: LatLng, to: LatLng, options?: QueryRouteOptions): Promise<RouteResult> {
  const approach = await findBestApproach(from, to, options)
  return queryRoute(from, approach, options)
}
