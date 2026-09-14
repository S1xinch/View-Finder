import { haversineDistanceMeters } from '../geo/units'
import type { PeakCandidate } from '../elevation/types'
import type { Viewpoint } from '../osm/types'

// If a computed local maximum lands within this distance of an existing
// OSM-tagged point, it's almost certainly the same real-world feature
// (OSM's coordinate for a peak/viewpoint node vs. our coarse grid sample
// won't line up exactly) - skip it rather than showing a duplicate marker.
const DEDUPE_RADIUS_METERS = 500

function computedPeakId(peak: PeakCandidate): string {
  return `computed:${peak.lat.toFixed(5)},${peak.lng.toFixed(5)}`
}

function toViewpoint(peak: PeakCandidate): Viewpoint {
  return {
    id: computedPeakId(peak),
    lat: peak.lat,
    lng: peak.lng,
    category: 'computed_peak',
    name: `High point (${Math.round(peak.elevationMeters)} m)`,
    elevationMeters: peak.elevationMeters,
    tags: {}
  }
}

// Merges OSM-tagged viewpoints/peaks with computed local-maxima candidates,
// dropping any computed peak that's likely the same feature as an existing
// tagged point.
export function mergeCandidates(viewpoints: Viewpoint[], computedPeaks: PeakCandidate[]): Viewpoint[] {
  const computedViewpoints = computedPeaks
    .filter((peak) => !viewpoints.some((vp) => haversineDistanceMeters(vp, peak) <= DEDUPE_RADIUS_METERS))
    .map(toViewpoint)

  return [...viewpoints, ...computedViewpoints]
}
