import { describe, expect, it } from 'vitest'
import { scoreCandidates } from './coolSpotScore'
import type { Viewpoint } from '../osm/types'

function makeViewpoint(overrides: Partial<Viewpoint> = {}): Viewpoint {
  return {
    id: 'v1',
    lat: -33.7,
    lng: 150.3,
    category: 'viewpoint',
    elevationMeters: 1000,
    tags: {},
    ...overrides
  }
}

describe('scoreCandidates', () => {
  it('returns [] for an empty candidate list', () => {
    expect(scoreCandidates([], [])).toEqual([])
  })

  it('scores every candidate 1.0 on elevation when all elevations are equal', () => {
    const [a, b] = scoreCandidates(
      [makeViewpoint({ id: 'a', elevationMeters: 500 }), makeViewpoint({ id: 'b', elevationMeters: 500 })],
      []
    )
    // Same category, same road data (none), same elevation -> identical scores
    expect(a.score).toBeCloseTo(b.score)
  })

  it('scores the higher of two candidates higher on elevation, all else equal', () => {
    const [low, high] = scoreCandidates(
      [makeViewpoint({ id: 'low', elevationMeters: 100 }), makeViewpoint({ id: 'high', elevationMeters: 900 })],
      []
    )
    expect(high.score).toBeGreaterThan(low.score)
  })

  it('scores an OSM-tagged point higher than an otherwise-identical computed peak', () => {
    const [computed, tagged] = scoreCandidates(
      [
        makeViewpoint({ id: 'computed', category: 'computed_peak' }),
        makeViewpoint({ id: 'tagged', category: 'viewpoint' })
      ],
      []
    )
    expect(tagged.score).toBeGreaterThan(computed.score)
  })

  it('scores a candidate closer to a road higher than one farther away', () => {
    const road = { coordinates: [[150.3, -33.7], [150.301, -33.7]] as [number, number][] }
    const [near, far] = scoreCandidates(
      [makeViewpoint({ id: 'near', lat: -33.7, lng: 150.3 }), makeViewpoint({ id: 'far', lat: -33.71, lng: 150.31 })],
      [road]
    )
    expect(near.score).toBeGreaterThan(far.score)
    expect(near.distanceToRoadMeters).not.toBeNull()
    expect(far.distanceToRoadMeters).not.toBeNull()
  })

  it('reports distanceToRoadMeters as null when there is no road data, without crashing', () => {
    const [result] = scoreCandidates([makeViewpoint()], [])
    expect(result.distanceToRoadMeters).toBeNull()
  })
})
