import { describe, expect, it } from 'vitest'
import { buildSampleGrid, findLocalMaxima } from './prominence'
import type { ElevationSample } from './types'

describe('buildSampleGrid', () => {
  it('produces gridSize^2 points covering the bbox in row-major order', () => {
    const bbox = { west: 0, south: 0, east: 10, north: 10 }
    const points = buildSampleGrid(bbox, 5)

    expect(points).toHaveLength(25)
    // first point is the center of the bottom-left cell
    expect(points[0].lat).toBeCloseTo(1)
    expect(points[0].lng).toBeCloseTo(1)
    // last point is the center of the top-right cell
    expect(points[24].lat).toBeCloseTo(9)
    expect(points[24].lng).toBeCloseTo(9)
  })
})

describe('findLocalMaxima', () => {
  function flatGrid(elevations: number[], gridSize: number): ElevationSample[] {
    return elevations.map((elevationMeters, i) => ({
      lat: Math.floor(i / gridSize),
      lng: i % gridSize,
      elevationMeters
    }))
  }

  it('finds a single sharp peak in an otherwise flat grid', () => {
    // 3x3 grid, center cell much higher than everything else
    const elevations = [100, 100, 100, 100, 2000, 100, 100, 100, 100]
    const samples = flatGrid(elevations, 3)

    const maxima = findLocalMaxima(samples, 3)
    expect(maxima).toHaveLength(1)
    expect(maxima[0].elevationMeters).toBe(2000)
    expect(maxima[0].lat).toBe(1)
    expect(maxima[0].lng).toBe(1)
  })

  it('does not flag a flat plateau (no strict local maximum) as a peak', () => {
    const elevations = Array(9).fill(500)
    const samples = flatGrid(elevations, 3)
    expect(findLocalMaxima(samples, 3)).toHaveLength(0)
  })

  it('ignores null (no-data) samples without crashing', () => {
    const elevations = [null, null, null, null, 800, null, null, null, null] as unknown as number[]
    const samples = flatGrid(elevations, 3)
    const maxima = findLocalMaxima(samples, 3)
    expect(maxima).toHaveLength(1)
    expect(maxima[0].elevationMeters).toBe(800)
  })

  it('excludes candidates below the prominence percentile threshold', () => {
    // Bottom half is a flat low plain (never a strict local max anyway -
    // ties don't count), most of the rest is a flat plateau at 10, and one
    // cell pokes up above the plateau. The plateau itself sits right at
    // the computed 75th-percentile threshold, so only the one point that
    // actually clears it survives.
    // prettier-ignore
    const elevations = [
      0, 0, 0, 0,
      0, 0, 0, 0,
      10, 10, 10, 10,
      10, 10, 999, 10
    ]
    const samples = flatGrid(elevations, 4)
    const maxima = findLocalMaxima(samples, 4)

    expect(maxima).toEqual([{ lat: 3, lng: 2, elevationMeters: 999 }])
  })
})
