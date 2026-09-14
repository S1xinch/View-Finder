import { describe, expect, it } from 'vitest'
import { buildLandUseQuery, parseExcludedLandAreas } from './landUseQueries'

describe('buildLandUseQuery', () => {
  it('embeds the bbox and queries farmland/private-access ways', () => {
    const query = buildLandUseQuery({ west: -105.5, south: 39.5, east: -105, north: 40 })
    expect(query).toContain('(39.5,-105.5,40,-105)')
    expect(query).toContain('landuse')
    expect(query).toContain('farmland')
    expect(query).toContain('access')
    expect(query).toContain('private')
  })
})

describe('parseExcludedLandAreas', () => {
  it('keeps closed ways as polygon rings', () => {
    const closedSquare = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
      { lat: 0, lon: 0 }
    ]

    const areas = parseExcludedLandAreas({
      elements: [{ type: 'way', id: 1, tags: { landuse: 'farmland' }, geometry: closedSquare }]
    })

    expect(areas).toHaveLength(1)
    expect(areas[0].id).toBe('osm:way:1')
    expect(areas[0].ring).toHaveLength(5)
    expect(areas[0].ring[0]).toEqual(areas[0].ring[4])
  })

  it('drops an open way (e.g. a private driveway, not an enclosed area)', () => {
    const areas = parseExcludedLandAreas({
      elements: [
        {
          type: 'way',
          id: 1,
          tags: { access: 'private' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 }
          ]
        }
      ]
    })
    expect(areas).toHaveLength(0)
  })

  it('drops ways with fewer than 4 nodes (cannot form a closed polygon)', () => {
    const areas = parseExcludedLandAreas({
      elements: [
        {
          type: 'way',
          id: 1,
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0 }
          ]
        }
      ]
    })
    expect(areas).toHaveLength(0)
  })
})
