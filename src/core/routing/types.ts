import type { LatLng } from '../elevation/types'

export type { LatLng }

export interface RouteStep {
  instruction: string
  distanceMeters: number
  // OSRM's raw maneuver type/modifier (e.g. 'turn' / 'left') and the [lng,
  // lat] point where this maneuver happens - kept alongside the already-
  // rendered `instruction` string so a turn-by-turn UI can pick a matching
  // arrow icon and measure live distance to the next maneuver, without
  // re-deriving either from the instruction text.
  type: string
  modifier?: string
  location: [number, number]
}

export interface RouteResult {
  // [lng, lat] pairs, GeoJSON coordinate order - ready to hand straight to
  // a MapLibre GeoJSON LineString source with no reordering.
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
  steps: RouteStep[]
}
