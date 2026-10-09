import { lineString, nearestPointOnLine, point } from '@turf/turf'
import type { RoadSegment } from '../osm/roadQueries'

// Beyond this, a spot isn't realistically "drive up and get out of the car"
// - it's a hike from the nearest road. Matches the app's whole premise
// (scenic spots reachable by car), so this is a hard exclusion, not a
// scoring penalty.
export const MAX_WALK_IN_METERS = 500

// null means "no road data available" (the fetch failed, or genuinely no
// roads in view) as distinct from "a real distance was computed" - callers
// should treat null as unknown rather than unreachable, so a data-fetch
// failure doesn't silently exclude every candidate.
export function distanceToNearestRoadMeters(
  candidate: { lat: number; lng: number },
  roads: RoadSegment[]
): number | null {
  if (roads.length === 0) return null

  // An exact turf distance per road is the slow part (~1ms each, thousands
  // of roads per tile). A road's bounding box gives a cheap lower bound on
  // its distance, so check the closest boxes first and stop once no
  // remaining box could beat the best real distance found.
  const candidatePoint = point([candidate.lng, candidate.lat])
  const byLowerBound = roads
    .map((road) => ({ road, bound: lowerBoundMeters(candidate, road) }))
    .sort((a, b) => a.bound - b.bound)

  let minDistance = Infinity
  for (const { road, bound } of byLowerBound) {
    if (bound >= minDistance) break
    if (road.coordinates.length < 2) continue
    const nearest = nearestPointOnLine(lineString(road.coordinates), candidatePoint, { units: 'meters' })
    const distance = nearest.properties.dist
    if (typeof distance === 'number' && distance < minDistance) {
      minDistance = distance
    }
  }

  return Number.isFinite(minDistance) ? minDistance : null
}

const METERS_PER_DEGREE = 111_320
const roadBounds = new WeakMap<RoadSegment, [number, number, number, number]>()

// Straight-line distance from the point to the road's bounding box,
// shrunk slightly so it never exceeds the true (haversine) distance.
function lowerBoundMeters(p: { lat: number; lng: number }, road: RoadSegment): number {
  let bounds = roadBounds.get(road)
  if (!bounds) {
    const lngs = road.coordinates.map((c) => c[0])
    const lats = road.coordinates.map((c) => c[1])
    bounds = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]
    roadBounds.set(road, bounds)
  }
  const [west, south, east, north] = bounds
  const dLat = Math.max(0, south - p.lat, p.lat - north) * METERS_PER_DEGREE
  // Longitude degrees shrink toward the poles - use the most poleward
  // latitude involved so the bound stays a lower bound.
  const maxAbsLat = Math.max(Math.abs(p.lat), Math.abs(south), Math.abs(north))
  const dLng = Math.max(0, west - p.lng, p.lng - east) * METERS_PER_DEGREE * Math.cos((maxAbsLat * Math.PI) / 180)
  return Math.hypot(dLat, dLng) * 0.99
}

// Whether a candidate should be kept. Unknown (null) road data errs
// permissive - see distanceToNearestRoadMeters above.
export function isReachableByRoad(distanceMeters: number | null, maxDistanceMeters = MAX_WALK_IN_METERS): boolean {
  return distanceMeters === null || distanceMeters <= maxDistanceMeters
}
