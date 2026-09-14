import type { RoadSegment } from '../osm/roadQueries'
import type { Viewpoint } from '../osm/types'
import { distanceToNearestRoadMeters, MAX_WALK_IN_METERS } from './roadReachability'

// Named weights, not magic numbers, so a future filter-weights UI (or just
// a future reader of this file) has something to point at.
const WEIGHTS = {
  // Elevation relative to the rest of the current candidate set - not an
  // absolute scale, since "impressively high" is relative to the
  // surrounding area (a 400m hill stands out on a coastal plain; it's
  // nothing in the Rockies).
  elevation: 0.5,
  // A human already bothered to tag this as a viewpoint/peak/alpine hut in
  // OSM - that's a stronger "this is actually worth seeing" signal than an
  // elevation grid can provide on its own.
  osmTagBonus: 0.3,
  // Closer to a road scores higher, within the walk-in radius that
  // roadReachability.ts already hard-filters on.
  roadProximity: 0.2
}

export interface ScoredViewpoint extends Viewpoint {
  score: number
  distanceToRoadMeters: number | null
}

function elevationScores(candidates: Viewpoint[]): number[] {
  const elevations = candidates.map((c) => c.elevationMeters ?? 0)
  const min = Math.min(...elevations)
  const max = Math.max(...elevations)
  const range = max - min

  if (range === 0) return candidates.map(() => 1)
  return elevations.map((e) => (e - min) / range)
}

export function scoreCandidates(candidates: Viewpoint[], roads: RoadSegment[]): ScoredViewpoint[] {
  if (candidates.length === 0) return []

  const elevScores = elevationScores(candidates)

  return candidates.map((candidate, i) => {
    const distanceToRoadMeters = distanceToNearestRoadMeters(candidate, roads)
    // Unknown road distance (no data) scores as neutral - it shouldn't
    // drag a candidate down just because we couldn't determine proximity.
    const roadScore =
      distanceToRoadMeters === null ? 0.5 : Math.max(0, 1 - distanceToRoadMeters / MAX_WALK_IN_METERS)
    const osmTagScore = candidate.category === 'computed_peak' ? 0 : 1

    const score =
      WEIGHTS.elevation * elevScores[i] + WEIGHTS.osmTagBonus * osmTagScore + WEIGHTS.roadProximity * roadScore

    return { ...candidate, score, distanceToRoadMeters }
  })
}
