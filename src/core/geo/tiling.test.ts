import { describe, expect, it } from 'vitest'
import { splitBBox } from './tiling'

describe('splitBBox', () => {
  it('returns the bbox unchanged when it is already small', () => {
    const bbox = { west: -105.1, south: 39.9, east: -105.0, north: 40.0 }
    expect(splitBBox(bbox)).toEqual([bbox])
  })

  it('splits a large bbox into a grid of smaller tiles covering the same area', () => {
    const bbox = { west: -106, south: 39, east: -104, north: 41 } // 2deg x 2deg = 4 deg^2
    const tiles = splitBBox(bbox, 1) // cap at 1 deg^2 -> 2x2 grid

    expect(tiles.length).toBe(4)
    for (const tile of tiles) {
      expect(tile.east - tile.west).toBeCloseTo(1)
      expect(tile.north - tile.south).toBeCloseTo(1)
    }
    expect(Math.min(...tiles.map((t) => t.west))).toBeCloseTo(bbox.west)
    expect(Math.max(...tiles.map((t) => t.east))).toBeCloseTo(bbox.east)
  })

  it('caps the grid so a huge (e.g. whole-continent) bbox never explodes into thousands of tiles', () => {
    const continentBBox = { west: 110, south: -45, east: 155, north: -10 } // roughly all of Australia
    const tiles = splitBBox(continentBBox)
    expect(tiles.length).toBeLessThanOrEqual(64)
  })
})
