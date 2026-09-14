import { describe, expect, it } from 'vitest'
import { distanceToNearestRoadMeters, isReachableByRoad, MAX_WALK_IN_METERS } from './roadReachability'

describe('distanceToNearestRoadMeters', () => {
  it('returns null when there is no road data', () => {
    expect(distanceToNearestRoadMeters({ lat: -33.7, lng: 150.3 }, [])).toBeNull()
  })

  it('returns ~0 for a point on the road itself', () => {
    const road = { id: 'osm:way:1', coordinates: [[150.3, -33.7], [150.31, -33.71]] as [number, number][] }
    const distance = distanceToNearestRoadMeters({ lat: -33.7, lng: 150.3 }, [road])
    expect(distance).not.toBeNull()
    expect(distance as number).toBeLessThan(1)
  })

  it('picks the closest of several roads', () => {
    const nearRoad = { id: 'osm:way:1', coordinates: [[150.3, -33.7], [150.301, -33.7]] as [number, number][] }
    const farRoad = { id: 'osm:way:2', coordinates: [[151.3, -34.7], [151.301, -34.7]] as [number, number][] }
    const distance = distanceToNearestRoadMeters({ lat: -33.7, lng: 150.3005 }, [farRoad, nearRoad])
    expect(distance as number).toBeLessThan(100)
  })
})

describe('isReachableByRoad', () => {
  it('treats unknown (null) distance as reachable - errs permissive on missing data', () => {
    expect(isReachableByRoad(null)).toBe(true)
  })

  it('keeps a candidate within the max walk-in distance', () => {
    expect(isReachableByRoad(MAX_WALK_IN_METERS - 1)).toBe(true)
    expect(isReachableByRoad(MAX_WALK_IN_METERS)).toBe(true)
  })

  it('excludes a candidate beyond the max walk-in distance', () => {
    expect(isReachableByRoad(MAX_WALK_IN_METERS + 1)).toBe(false)
  })
})
