import { describe, expect, it } from 'vitest'
import { splitBBox, snapBBoxToGrid } from './tiling'

describe('splitBBox', () => {
  it('returns a single grid-aligned tile when the bbox fits within one cell', () => {
    const bbox = { west: 0.1, south: 0.1, east: 0.2, north: 0.2 }
    const tiles = splitBBox(bbox, 0.25)
    expect(tiles).toEqual([{ west: 0, east: 0.25, south: 0, north: 0.25 }])
  })

  it('handles a bbox exactly aligned to grid boundaries without spilling into an extra tile', () => {
    const bbox = { west: 0, south: 0, east: 0.25, north: 0.25 }
    const tiles = splitBBox(bbox, 0.25)
    expect(tiles).toEqual([{ west: 0, east: 0.25, south: 0, north: 0.25 }])
  })

  it('splits a bbox spanning multiple cells into a grid of fixed-size tiles', () => {
    const bbox = { west: -106, south: 39, east: -104, north: 41 } // 2deg x 2deg
    const tiles = splitBBox(bbox, 1)

    expect(tiles.length).toBe(4)
    for (const tile of tiles) {
      expect(tile.east - tile.west).toBeCloseTo(1)
      expect(tile.north - tile.south).toBeCloseTo(1)
    }
  })

  it('returns identical tiles for two different viewports that land in the same grid cells - the whole point of a fixed grid, so a small pan reuses the cache instead of invalidating it', () => {
    const tileSizeDeg = 0.25
    const viewportA = { west: 0.05, south: 0.05, east: 0.2, north: 0.2 }
    const viewportB = { west: 0.1, south: 0.02, east: 0.24, north: 0.18 } // shifted, but same cell
    expect(splitBBox(viewportA, tileSizeDeg)).toEqual(splitBBox(viewportB, tileSizeDeg))
  })

  it('caps the grid so a huge (e.g. whole-continent) bbox never explodes into thousands of tiles', () => {
    const continentBBox = { west: 110, south: -45, east: 155, north: -10 } // roughly all of Australia
    const tiles = splitBBox(continentBBox)
    expect(tiles.length).toBeLessThanOrEqual(64)
  })
})

describe('snapBBoxToGrid', () => {
  it('rounds a bbox outward to the nearest grid lines as a single bbox, without splitting it', () => {
    const bbox = { west: 0.1, south: 0.1, east: 0.3, north: 0.3 }
    expect(snapBBoxToGrid(bbox, 0.25)).toEqual({ west: 0, east: 0.5, south: 0, north: 0.5 })
  })

  it('leaves a bbox already aligned to grid boundaries unchanged', () => {
    const bbox = { west: 0, south: 0, east: 0.25, north: 0.25 }
    expect(snapBBoxToGrid(bbox, 0.25)).toEqual(bbox)
  })

  it('returns the same snapped bbox for two different viewports that round to the same grid lines - what lets a small pan reuse the cache instead of invalidating it', () => {
    const tileSizeDeg = 0.25
    const viewportA = { west: 0.05, south: 0.05, east: 0.2, north: 0.2 }
    const viewportB = { west: 0.1, south: 0.02, east: 0.24, north: 0.18 }
    expect(snapBBoxToGrid(viewportA, tileSizeDeg)).toEqual(snapBBoxToGrid(viewportB, tileSizeDeg))
  })
})
