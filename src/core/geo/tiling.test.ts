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
})
