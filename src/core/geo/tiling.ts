import type { BBox } from './types'

// Tiles are cut from a FIXED, absolute-coordinate grid (rather than
// dividing each viewport into pieces relative to itself) so that panning
// reuses previously-fetched tiles instead of invalidating everything: a
// tile's identity depends only on its own grid cell, never on the
// specific viewport that happened to touch it, so two
// overlapping-but-different viewports share a cache hit for every cell
// they have in common. This is the same principle every tiled map/data
// service uses (XYZ map tiles, etc.) - without it, a viewport-relative
// split means even a one-pixel pan produces entirely new tile boundaries,
// so every single pan was a full cache miss and a fresh burst of Overpass
// requests, which is what was driving repeated rate-limiting during
// normal use.
const TILE_SIZE_DEG = 0.25

// Hard safety cap: without this, a very zoomed-out viewport (e.g. a whole
// continent) would touch a grid side in the hundreds, producing tens of
// thousands of tiles queried one at a time — effectively hanging forever.
// Callers should also gate on zoom level before fetching at all (see
// renderer/hooks/useViewpoints.ts); this cap is the last line of defense.
const MAX_GRID_SIDE = 8 // at most 8x8 = 64 tiles

export function splitBBox(bbox: BBox, tileSizeDeg = TILE_SIZE_DEG): BBox[] {
  const width = bbox.east - bbox.west
  const height = bbox.north - bbox.south
  if (width <= 0 || height <= 0) return [bbox]

  const minCol = Math.floor(bbox.west / tileSizeDeg)
  const maxCol = Math.ceil(bbox.east / tileSizeDeg) - 1
  const minRow = Math.floor(bbox.south / tileSizeDeg)
  const maxRow = Math.ceil(bbox.north / tileSizeDeg) - 1

  const totalCols = maxCol - minCol + 1
  const totalRows = maxRow - minRow + 1
  const cols = Math.min(MAX_GRID_SIDE, totalCols)
  const rows = Math.min(MAX_GRID_SIDE, totalRows)
  // When capped, center the kept window within the full range rather than
  // always dropping the same (east/north) edge - this case is a defensive
  // last resort (the zoom gate normally keeps viewports well under the
  // cap), so it only needs to be reasonable, not exhaustive.
  const colStart = minCol + Math.floor((totalCols - cols) / 2)
  const rowStart = minRow + Math.floor((totalRows - rows) / 2)

  const tiles: BBox[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = colStart + c
      const row = rowStart + r
      tiles.push({
        west: col * tileSizeDeg,
        east: (col + 1) * tileSizeDeg,
        south: row * tileSizeDeg,
        north: (row + 1) * tileSizeDeg
      })
    }
  }
  return tiles
}

// Rounds a bbox outward to the nearest grid lines, without splitting it -
// for a query that should stay a single request regardless of viewport
// size (unlike splitBBox, which deliberately caps each piece's area for
// Overpass fair-use), this is what gives it the same "small pans keep
// hitting the same cache key" property as tiling does, without also
// multiplying one query into several and turning a single pan into a
// burst of simultaneous requests.
export function snapBBoxToGrid(bbox: BBox, tileSizeDeg = TILE_SIZE_DEG): BBox {
  return {
    west: Math.floor(bbox.west / tileSizeDeg) * tileSizeDeg,
    east: Math.ceil(bbox.east / tileSizeDeg) * tileSizeDeg,
    south: Math.floor(bbox.south / tileSizeDeg) * tileSizeDeg,
    north: Math.ceil(bbox.north / tileSizeDeg) * tileSizeDeg
  }
}
