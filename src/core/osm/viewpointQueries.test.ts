import { describe, expect, it } from 'vitest'
import { buildViewpointQuery, parseViewpoints } from './viewpointQueries'

describe('buildViewpointQuery', () => {
  it('embeds the bbox in south,west,north,east order for each tag filter', () => {
    const query = buildViewpointQuery({ west: -105.5, south: 39.5, east: -105, north: 40 })
    expect(query).toContain('(39.5,-105.5,40,-105)')
    expect(query).toContain('tourism"="viewpoint"')
    expect(query).toContain('natural"="peak"')
  })
})

describe('parseViewpoints', () => {
  it('extracts tagged nodes and reads the ele tag as elevation', () => {
    const viewpoints = parseViewpoints({
      elements: [
        {
          type: 'node',
          id: 1,
          lat: 40.01,
          lon: -105.5,
          tags: { tourism: 'viewpoint', name: 'Sunrise Point', ele: '2743' }
        },
        {
          type: 'node',
          id: 2,
          lat: 40.02,
          lon: -105.6,
          tags: { natural: 'peak', name: 'Storm Peak' }
        },
        // not a recognized category -> dropped
        { type: 'node', id: 3, lat: 40.03, lon: -105.7, tags: { shop: 'bakery' } },
        // no coordinates (e.g. an unresolved way) -> dropped
        { type: 'way', id: 4, tags: { tourism: 'viewpoint' } }
      ]
    })

    expect(viewpoints).toHaveLength(2)
    expect(viewpoints[0]).toMatchObject({
      id: 'osm:node:1',
      category: 'viewpoint',
      name: 'Sunrise Point',
      elevationMeters: 2743
    })
    expect(viewpoints[1]).toMatchObject({ id: 'osm:node:2', category: 'peak', name: 'Storm Peak' })
  })
})
