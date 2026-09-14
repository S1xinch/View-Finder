import { describe, expect, it } from 'vitest'
import { haversineDistanceMeters, metersToFeet } from './units'

describe('metersToFeet', () => {
  it('converts meters to feet', () => {
    expect(metersToFeet(1)).toBeCloseTo(3.28084, 4)
  })
})

describe('haversineDistanceMeters', () => {
  it('is zero for identical points', () => {
    const p = { lat: 40, lng: -105 }
    expect(haversineDistanceMeters(p, p)).toBe(0)
  })

  it('roughly matches known distance (SF to LA, ~559km)', () => {
    const sf = { lat: 37.7749, lng: -122.4194 }
    const la = { lat: 34.0522, lng: -118.2437 }
    const distanceKm = haversineDistanceMeters(sf, la) / 1000
    expect(distanceKm).toBeGreaterThan(550)
    expect(distanceKm).toBeLessThan(570)
  })
})
