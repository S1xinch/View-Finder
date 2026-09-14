import type { BBox } from '../geo/types'
import type { OverpassResponse } from './overpassClient'

export function buildLandUseQuery(bbox: BBox): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `[out:json][timeout:25];
(
  way["landuse"~"^(farmland|farmyard|orchard)$"](${bboxStr});
  way["access"="private"](${bboxStr});
);
out geom;`
}

// A closed ring of [lng, lat] pairs (first and last point equal), matching
// GeoJSON polygon-ring coordinate order.
export interface ExcludedLandArea {
  ring: [number, number][]
}

export function parseExcludedLandAreas(response: OverpassResponse): ExcludedLandArea[] {
  const areas: ExcludedLandArea[] = []

  for (const el of response.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 4) continue

    const ring: [number, number][] = el.geometry.map((node) => [node.lon, node.lat])
    const [firstLng, firstLat] = ring[0]
    const [lastLng, lastLat] = ring[ring.length - 1]
    // Only a closed way (first node === last node) is a real polygon -
    // an open way tagged access=private (e.g. a private driveway/track)
    // isn't an area we can test point-in-polygon against.
    if (firstLng !== lastLng || firstLat !== lastLat) continue

    areas.push({ ring })
  }

  return areas
}
