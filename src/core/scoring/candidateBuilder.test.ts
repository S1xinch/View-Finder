import { describe, expect, it } from 'vitest'
import { mergeCandidates } from './candidateBuilder'
import type { Viewpoint } from '../osm/types'

const osmViewpoint: Viewpoint = {
  id: 'osm:node:1',
  lat: -33.7,
  lng: 150.3,
  category: 'viewpoint',
  name: 'Sunrise Point',
  tags: { tourism: 'viewpoint' }
}

describe('mergeCandidates', () => {
  it('appends computed peaks as viewpoint-shaped entries with a computed_peak category', () => {
    const result = mergeCandidates([], [{ lat: -34, lng: 151, elevationMeters: 987 }])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      category: 'computed_peak',
      lat: -34,
      lng: 151,
      elevationMeters: 987,
      tags: {}
    })
    expect(result[0].name).toContain('987')
  })

  it('drops a computed peak that is very close to an existing OSM point', () => {
    // ~50m away from osmViewpoint - well within the dedupe radius
    const nearby = { lat: -33.7004, lng: 150.3, elevationMeters: 500 }
    const result = mergeCandidates([osmViewpoint], [nearby])
    expect(result).toEqual([osmViewpoint])
  })

  it('keeps a computed peak that is far from any existing OSM point', () => {
    const farAway = { lat: -34.5, lng: 151.5, elevationMeters: 500 }
    const result = mergeCandidates([osmViewpoint], [farAway])
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(osmViewpoint)
    expect(result[1].category).toBe('computed_peak')
  })
})
