import type { BBox } from './types'

// Keeps individual Overpass queries small and fast (public instance fair-use)
// by splitting a large viewport bbox into a grid of smaller tiles.
const MAX_TILE_AREA_DEG2 = 0.0625 // ~0.25° x 0.25°

// Hard safety cap: without this, a very zoomed-out viewport (e.g. a whole
// continent) computes a grid side in the hundreds, producing tens of
// thousands of tiles that would be queried one at a time with a delay
// between each — effectively hanging forever. Callers should also gate on
// zoom level before fetching at all (see renderer/hooks/useViewpoints.ts);
// this cap is the last line of defense.
const MAX_GRID_SIDE = 8 // at most 8x8 = 64 tiles

export function splitBBox(bbox: BBox, maxAreaDeg2 = MAX_TILE_AREA_DEG2): BBox[] {
  const width = bbox.east - bbox.west
  const height = bbox.north - bbox.south
  if (width <= 0 || height <= 0) return [bbox]

  const area = width * height
  if (area <= maxAreaDeg2) return [bbox]

  const cols = Math.min(MAX_GRID_SIDE, Math.max(1, Math.ceil(Math.sqrt(area / maxAreaDeg2))))
  const rows = cols
  const tileWidth = width / cols
  const tileHeight = height / rows

  const tiles: BBox[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        west: bbox.west + col * tileWidth,
        east: bbox.west + (col + 1) * tileWidth,
        south: bbox.south + row * tileHeight,
        north: bbox.south + (row + 1) * tileHeight
      })
    }
  }
  return tiles
}
