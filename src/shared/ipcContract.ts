// Types shared across main, preload, and renderer for the typed IPC surface.
// Kept fully dependency-free (no imports at all) so it can sit in both the
// node (main/preload/core) and web (renderer) TypeScript projects without
// pulling either into the other's compile boundary. These shapes mirror
// src/core/geo/types.ts and src/core/osm/types.ts; TS's structural typing
// means values from core satisfy these without any import needed.

export interface BBox {
  west: number
  south: number
  east: number
  north: number
}

export type ViewpointCategory = 'viewpoint' | 'peak' | 'alpine_hut' | 'computed_peak'

export interface Viewpoint {
  id: string
  lat: number
  lng: number
  category: ViewpointCategory
  name?: string
  elevationMeters?: number
  tags: Record<string, string>
  score?: number
  distanceToRoadMeters?: number | null
}

// A closed ring of [lng, lat] pairs (first and last point equal) - a
// farmland or private-access polygon a candidate got excluded for landing
// inside (see core/scoring/landUseFilter.ts).
export interface ExcludedLandArea {
  ring: [number, number][]
}

export type AppPlatform = 'win32' | 'darwin' | 'linux' | 'web'

export interface AppInfo {
  name: string
  version: string
  platform: AppPlatform
}

export interface LatLng {
  lat: number
  lng: number
}

export interface RouteStep {
  instruction: string
  distanceMeters: number
}

export interface RouteResult {
  coordinates: [number, number][]
  distanceMeters: number
  durationSeconds: number
  steps: RouteStep[]
}

export interface ViewFinderApi {
  getAppInfo: () => Promise<AppInfo>
  getViewpoints: (bbox: BBox) => Promise<Viewpoint[]>
  getExcludedLand: (bbox: BBox) => Promise<ExcludedLandArea[]>
  getRoute: (from: LatLng, to: LatLng) => Promise<RouteResult>
}
