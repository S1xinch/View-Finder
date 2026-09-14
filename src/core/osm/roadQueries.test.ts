import { describe, expect, it } from 'vitest'
import { buildRoadQuery, parseRoads } from './roadQueries'

describe('buildRoadQuery', () => {
  it('embeds the bbox and restricts to car-accessible highway classes', () => {
    const query = buildRoadQuery({ west: -105.5, south: 39.5, east: -105, north: 40 })
    expect(query).toContain('(39.5,-105.5,40,-105)')
    expect(query).toContain('highway')
    expect(query).toContain('residential')
    expect(query).not.toContain('footway')
    expect(query).toContain('out geom;')
  })
})

describe('parseRoads', () => {
  it('converts way geometry into [lng, lat] coordinate lists', () => {
    const roads = parseRoads({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { highway: 'residential' },
          geometry: [
            { lat: -33.7, lon: 150.3 },
            { lat: -33.71, lon: 150.31 }
          ]
        },
        // no geometry (e.g. an unresolved reference) -> dropped
        { type: 'way', id: 2, tags: { highway: 'residential' } },
        // a single-point geometry can't form a line -> dropped
        { type: 'way', id: 3, geometry: [{ lat: -33.7, lon: 150.3 }] },
        // nodes aren't roads -> dropped
        { type: 'node', id: 4, lat: -33.7, lon: 150.3 }
      ]
    })

    expect(roads).toHaveLength(1)
    expect(roads[0].id).toBe('osm:way:1')
    expect(roads[0].coordinates).toEqual([
      [150.3, -33.7],
      [150.31, -33.71]
    ])
  })
})
