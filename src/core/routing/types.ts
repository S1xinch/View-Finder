import type { LatLng } from '../elevation/types'

export type { LatLng }

export interface RouteStep {
  instruction: string
  distanceMeters: number
}

export interface RouteResult {
  // [lng, lat] pairs, GeoJSON coordinate order - ready to hand straight to
  // a MapLibre GeoJSON LineString source with no reordering.
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
  steps: RouteStep[]
}
