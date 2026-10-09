import { describe, expect, it } from 'vitest'
import { MAX_TILES, tilesAlongRoute, tilesForBounds } from './offlineArea'

describe('tilesForBounds', () => {
  it('gives one tile per zoom for a tiny area, numbered like the standard slippy map', () => {
    const sydney = { west: 151.2093, east: 151.2093, south: -33.8688, north: -33.8688 }
    const tiles = tilesForBounds(sydney, 8, 14)
    expect(tiles).toHaveLength(7)
    expect(tiles.at(-1)).toEqual([14, 15073, 9831])
  })

  it('covers every tile the area touches', () => {
    // Straddles the prime meridian and the equator at zoom 1: all four tiles.
    expect(tilesForBounds({ west: -1, east: 1, south: -1, north: 1 }, 1, 1)).toHaveLength(4)
  })
})

describe('tilesAlongRoute', () => {
  // ~20 km east-west across the Blue Mountains.
  const route: [number, number][] = [
    [150.2, -33.65],
    [150.4, -33.65]
  ]

  it('covers the line at every zoom, with a margin at the closest zooms', () => {
    const tiles = tilesAlongRoute(route, 10, 14)
    const at = (z: number): [number, number, number][] => tiles.filter((t) => t[0] === z)
    // The line crosses columns 15027-15036 at z14 - every one, padded one
    // either side, and one row either side.
    const xs = new Set(at(14).map((t) => t[1]))
    expect(xs.size).toBe(15036 - 15027 + 1 + 2)
    expect(Math.min(...xs)).toBe(15027 - 1)
    expect(Math.max(...xs)).toBe(15036 + 1)
    expect(new Set(at(14).map((t) => t[2])).size).toBe(3)
    expect(new Set(at(10).map((t) => t[2])).size).toBe(1)
  })

  it('stays within the tile budget on a very long drive', () => {
    const sydneyToPerth: [number, number][] = [
      [151.2, -33.87],
      [115.86, -31.95]
    ]
    expect(tilesAlongRoute(sydneyToPerth).length).toBeLessThanOrEqual(MAX_TILES)
  })
})
