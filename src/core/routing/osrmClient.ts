import type { LatLng, RouteResult, RouteStep } from './types'

// Free, no-API-key driving directions via OSRM's public demo server. Same
// "free/open stack, no signup" philosophy as Overpass/OpenTopoData
// elsewhere in core/ - self-hostable later if this demo instance's fair-use
// limits become a problem, without any caller-side changes.
export const DEFAULT_OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving'

const REQUEST_TIMEOUT_MS = 15_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

interface OsrmManeuver {
  type: string
  modifier?: string
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

  const url = `${endpoint}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`

  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'ViewFinder/1.0 (+https://github.com/s1xinch/view-finder)' },
    signal
  })

  if (!response.ok) {
    throw new Error(`OSRM request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as OsrmResponse

  if (data.code !== 'Ok' || data.routes.length === 0) {
    throw new Error(`OSRM returned no route: ${data.code}${data.message ? ` (${data.message})` : ''}`)
  }

  const route = data.routes[0]
  const steps: RouteStep[] = route.legs.flatMap((leg) =>
    leg.steps.map((step) => ({ instruction: describeStep(step), distanceMeters: step.distance }))
  )

  return {
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    steps
  }
}
