import type { BBox } from '../geo/types'
import type { OverpassResponse } from './overpassClient'
import type { Viewpoint, ViewpointCategory } from './types'

export function buildViewpointQuery(bbox: BBox): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `[out:json][timeout:25];
(
  node["tourism"="viewpoint"](${bboxStr});
  node["natural"="peak"](${bboxStr});
  node["tourism"="alpine_hut"](${bboxStr});
);
out body;`
}

function categoryFromTags(tags: Record<string, string>): ViewpointCategory | null {
  if (tags.tourism === 'viewpoint') return 'viewpoint'
  if (tags.natural === 'peak') return 'peak'
  if (tags.tourism === 'alpine_hut') return 'alpine_hut'
  return null
}

export function parseViewpoints(response: OverpassResponse): Viewpoint[] {
  const viewpoints: Viewpoint[] = []

  for (const el of response.elements) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue
    const tags = el.tags ?? {}
    const category = categoryFromTags(tags)
    if (!category) continue

    const elevation = tags.ele ? Number.parseFloat(tags.ele) : undefined
    viewpoints.push({
      id: `osm:node:${el.id}`,
      lat: el.lat,
      lng: el.lon,
      category,
      name: tags.name,
      elevationMeters: elevation !== undefined && !Number.isNaN(elevation) ? elevation : undefined,
      tags
    })
  }

  return viewpoints
}
