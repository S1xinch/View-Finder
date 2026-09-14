import { booleanPointInPolygon, point, polygon } from '@turf/turf'
import type { ExcludedLandArea } from '../osm/landUseQueries'
import type { Viewpoint } from '../osm/types'

// Drops any candidate that falls inside a farmland/private-access polygon.
// Best-effort, not a guarantee: OSM tagging coverage varies a lot by
// region, so this can't catch every real property boundary - see the
// architecture notes on this in the plan doc.
export function filterExcludedLand(candidates: Viewpoint[], excludedAreas: ExcludedLandArea[]): Viewpoint[] {
  if (excludedAreas.length === 0) return candidates

  const polygons = excludedAreas.flatMap((area) => {
    try {
      return [polygon([area.ring])]
    } catch {
      // A malformed ring (e.g. self-intersecting) shouldn't take down
      // filtering for every other candidate - just skip this one area.
      return []
    }
  })

  return candidates.filter((candidate) => {
    const candidatePoint = point([candidate.lng, candidate.lat])
    return !polygons.some((poly) => booleanPointInPolygon(candidatePoint, poly))
  })
}
