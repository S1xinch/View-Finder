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
  // Set instead of dropping the spot, so the UI can still list it under
  // "Private land": on farmland/private land, or behind a locked/private
  // gate (core/scoring/gateReachability.ts).
  restricted?: 'private_land' | 'gated'
}
