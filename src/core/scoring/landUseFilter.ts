import { booleanPointInPolygon, point, polygon } from '@turf/turf'
import type { ExcludedLandArea } from '../osm/landUseQueries'
import type { Viewpoint } from '../osm/types'
import type { NswTenureClass } from '../landTenure/nswLandTenureClient'

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

// Genuinely need landowner permission to be there - Crownland-Leasehold is
// deliberately not included here even though it's often fenced/access-
// restricted in practice (grazing leases etc): it's still public land, so
// it's a softer case than Private/Indigenous Owned and isn't hard-excluded.
export const EXCLUDED_TENURE_CLASSES: ReadonlySet<NswTenureClass> = new Set(['Private', 'Indigenous Owned'])

// Point lookups are keyed to 4 decimal places (~11m) rather than the
// candidate's exact float coordinates - the raster itself is far coarser
// than that, and rounding means two candidates a few meters apart (or the
// same peak re-requested after a re-pan) reuse one cached lookup instead
// of firing a second identical request.
export function tenureCacheKey(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`
}

// Second, independent exclusion signal alongside filterExcludedLand's OSM-
// tagged polygons above, not a replacement: OSM coverage is real-time but
// patchy in Australia, while NSW's own Land Tenure dataset is authoritative
// but NSW-only and raster-coarse. tenureByKey is populated by
// coolSpotOrchestrator.ts's point-sampled lookups (see
// core/landTenure/nswLandTenureClient.ts) - a candidate missing from the
// map (network failure, or a lookup that hasn't resolved yet) is left
// alone rather than excluded, since a missed exclusion is a far safer
// failure than hiding a legitimate peak.
export function filterExcludedTenure(
  candidates: Viewpoint[],
  tenureByKey: ReadonlyMap<string, NswTenureClass | null>
): Viewpoint[] {
  if (tenureByKey.size === 0) return candidates

  return candidates.filter((candidate) => {
    const tenure = tenureByKey.get(tenureCacheKey(candidate))
    return !tenure || !EXCLUDED_TENURE_CLASSES.has(tenure)
  })
}
