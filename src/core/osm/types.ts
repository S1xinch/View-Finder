export type ViewpointCategory = 'viewpoint' | 'peak' | 'alpine_hut' | 'computed_peak'

export interface Viewpoint {
  id: string
  lat: number
  lng: number
  category: ViewpointCategory
  name?: string
  elevationMeters?: number
  tags: Record<string, string>
  // Populated by core/scoring/coolSpotScore.ts once road/land-use data is
  // available (Phase 4). Optional because earlier-phase code (existing
  // tests, candidateBuilder's merge step before scoring runs) still
  // constructs plain Viewpoints without them.
  score?: number
  distanceToRoadMeters?: number | null
}
