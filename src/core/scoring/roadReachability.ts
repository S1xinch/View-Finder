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

  const candidatePoint = point([candidate.lng, candidate.lat])
  let minDistance = Infinity

  for (const road of roads) {
    if (road.coordinates.length < 2) continue
    const line = lineString(road.coordinates)
    const nearest = nearestPointOnLine(line, candidatePoint, { units: 'meters' })
    const distance = nearest.properties.dist
    if (typeof distance === 'number' && distance < minDistance) {
      minDistance = distance
    }
  }

  return Number.isFinite(minDistance) ? minDistance : null
}

// Whether a candidate should be kept. Unknown (null) road data errs
// permissive - see distanceToNearestRoadMeters above.
export function isReachableByRoad(distanceMeters: number | null, maxDistanceMeters = MAX_WALK_IN_METERS): boolean {
  return distanceMeters === null || distanceMeters <= maxDistanceMeters
}
