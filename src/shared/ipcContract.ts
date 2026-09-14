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

export type ViewpointCategory = 'viewpoint' | 'peak' | 'alpine_hut'

export interface Viewpoint {
  id: string
  lat: number
  lng: number
  category: ViewpointCategory
  name?: string
  elevationMeters?: number
  tags: Record<string, string>
}

export type AppPlatform = 'win32' | 'darwin' | 'linux'

export interface AppInfo {
  name: string
  version: string
  platform: AppPlatform
}

export interface ViewFinderApi {
  getAppInfo: () => Promise<AppInfo>
  getViewpoints: (bbox: BBox) => Promise<Viewpoint[]>
}
