import type { Map as MapLibreMap, VectorTileSource } from 'maplibre-gl'
import { MAP_STYLE_URL } from '../map/mapStyle'

// "Save this area for offline" (website only): copies the visible area's
// vector tiles, plus the style, sprites and fonts, into Cache Storage for
// build/sw.js to serve when there's no reception. Spot data needs nothing
// here - the website already keeps every search in IndexedDB and reads that
// first (src/site/IndexedDbCacheStore.ts).

// Keep in sync with build/sw.js. Saved areas (and the style/fonts) live in
// OFFLINE_CACHE until cleared; DRIVE_CACHE holds the current drive only.
export const OFFLINE_CACHE = 'vf-map-v1'
export const DRIVE_CACHE = 'vf-drive-v1'
export const offlineTileKey = (z: number, x: number, y: number): string =>
  `https://vf-offline.invalid/tiles/${z}/${x}/${y}.pbf`

// OpenFreeMap's vector tiles stop at 14; the map overzooms past that.
const MIN_ZOOM = 8
const MAX_ZOOM = 14
// Roughly 50 MB - about a 90 km square.
export const MAX_TILES = 1500
const CONCURRENCY = 6
const SAVED_FLAG_KEY = 'vf-offline-saved'

// Set by src/site/main.tsx - the desktop app has no service worker.
export const offlineSupport = { enabled: false }

export interface Bounds {
  west: number
  south: number
  east: number
  north: number
}

type Tile = [number, number, number]

// Standard slippy-map tile numbering.
const clampTile = (v: number, z: number): number => Math.min(2 ** z - 1, Math.max(0, v))
const tileX = (lng: number, z: number): number => clampTile(Math.floor(((lng + 180) / 360) * 2 ** z), z)
function tileY(lat: number, z: number): number {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180
  return clampTile(Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z), z)
}

export function tilesForBounds(b: Bounds, minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM): Tile[] {
  const tiles: Tile[] = []
  for (let z = minZoom; z <= maxZoom; z++) {
    for (let x = tileX(b.west, z); x <= tileX(b.east, z); x++) {
      for (let y = tileY(b.north, z); y <= tileY(b.south, z); y++) tiles.push([z, x, y])
    }
  }
  return tiles
}

// A strip of tiles along a route ([lng, lat] points): every tile the line
// passes through, plus one tile either side at the closest zooms (~2-5 km)
// so the map isn't a ribbon. Long drives drop the margin, then the closest
// zoom (the map overzooms), to stay within MAX_TILES.
export function tilesAlongRoute(coords: [number, number][], minZoom = 10, maxZoom = MAX_ZOOM): Tile[] {
  const build = (padFromZoom: number, topZoom: number): Tile[] => {
    const seen = new Map<string, Tile>()
    for (let z = minZoom; z <= topZoom; z++) {
      const pad = z >= padFromZoom ? 1 : 0
      // Sample at half a tile's width so no tile the line crosses is skipped.
      const step = 180 / 2 ** z
      coords.forEach(([lng0, lat0], i) => {
        const [lng1, lat1] = coords[i + 1] ?? coords[i]
        const parts = Math.max(1, Math.ceil(Math.hypot(lng1 - lng0, lat1 - lat0) / step))
        for (let k = 0; k < parts; k++) {
          const x = tileX(lng0 + ((lng1 - lng0) * k) / parts, z)
          const y = tileY(lat0 + ((lat1 - lat0) * k) / parts, z)
          for (let dx = -pad; dx <= pad; dx++) {
            for (let dy = -pad; dy <= pad; dy++) {
              const t: Tile = [z, clampTile(x + dx, z), clampTile(y + dy, z)]
              seen.set(t.join('/'), t)
            }
          }
        }
      })
    }
    return [...seen.values()]
  }

  for (const [padFromZoom, topZoom] of [
    [maxZoom - 1, maxZoom],
    [Infinity, maxZoom],
    [Infinity, maxZoom - 1]
  ]) {
    const tiles = build(padFromZoom, topZoom)
    if (tiles.length <= MAX_TILES) return tiles
  }
  return build(Infinity, maxZoom - 2).slice(0, MAX_TILES)
}

export function viewBounds(map: MapLibreMap): Bounds {
  const b = map.getBounds()
  return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }
}

// Downloads the given tiles (and the style resources) into the offline
// cache. Shared by area saving here and drive saving.
export async function saveTilesOffline(
  map: MapLibreMap,
  tiles: Tile[],
  onProgress: (fraction: number) => void,
  cacheName = OFFLINE_CACHE
): Promise<{ tiles: number; bytes: number }> {
  if (tiles.length > MAX_TILES) throw new Error('Too much map to save at once - zoom in')

  const source = map.getSource('openmaptiles') as VectorTileSource | undefined
  const template = source?.tiles?.[0]
  if (!template) throw new Error('Map data not loaded yet')

  const cache = await caches.open(OFFLINE_CACHE)
  const tileCache = await caches.open(cacheName)
  // Ask the browser not to clear this under storage pressure (granted
  // automatically for an installed home-screen app).
  void navigator.storage?.persist?.()

  // Style, tile index, sprites and the Latin font range - small, and the map
  // can't draw anything offline without them.
  const style = map.getStyle()
  const sprite = typeof style.sprite === 'string' ? style.sprite : undefined
  const fonts = new Set<string>()
  for (const layer of style.layers) {
    const font = layer.type === 'symbol' ? layer.layout?.['text-font'] : undefined
    if (Array.isArray(font) && font.every((f) => typeof f === 'string')) fonts.add(font.join(','))
  }
  const glyphs = style.glyphs
  const extras = [
    MAP_STYLE_URL,
    ...(source?.url ? [source.url] : []),
    ...(sprite ? ['.json', '.png', '@2x.json', '@2x.png'].map((ext) => sprite + ext) : []),
    ...(glyphs ? [...fonts].map((f) => glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', '0-255')) : [])
  ]
  await Promise.all(extras.map((url) => cache.add(url).catch(() => undefined)))

  let done = 0
  let bytes = 0
  let failed = 0
  const queue = [...tiles]
  const worker = async (): Promise<void> => {
    for (let t = queue.pop(); t; t = queue.pop()) {
      const [z, x, y] = t
      try {
        // Already saved (e.g. the same drive picked up again) - nothing to do.
        if (await tileCache.match(offlineTileKey(z, x, y))) {
          onProgress(++done / tiles.length)
          continue
        }
        const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
        const body = await res.arrayBuffer()
        bytes += body.byteLength
        await tileCache.put(offlineTileKey(z, x, y), new Response(body, { headers: res.headers }))
      } catch {
        failed++
      }
      onProgress(++done / tiles.length)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (failed === tiles.length) throw new Error("Couldn't download the map - check your connection")

  if (cacheName === OFFLINE_CACHE) {
    try {
      localStorage.setItem(SAVED_FLAG_KEY, '1')
    } catch {
      // Only drives the "Clear offline maps" link.
    }
  }
  return { tiles: tiles.length - failed, bytes }
}

export function hasSavedAreas(): boolean {
  try {
    return localStorage.getItem(SAVED_FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export async function clearSavedAreas(): Promise<void> {
  await caches.delete(OFFLINE_CACHE)
  try {
    localStorage.removeItem(SAVED_FLAG_KEY)
  } catch {
    // Nothing to undo.
  }
}
