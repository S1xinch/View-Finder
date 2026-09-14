import type { BBox } from '../geo/types'
import type { OverpassResponse } from './overpassClient'

// Car-accessible road classes only — deliberately excludes footway, path,
// cycleway, steps, etc. so "near a road" actually means "reachable by car",
// matching the whole point of this app.
const CAR_ACCESSIBLE_HIGHWAY_CLASSES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'track' // includes many real-world "fire trail" style tracks
]

export function buildRoadQuery(bbox: BBox): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  const classes = CAR_ACCESSIBLE_HIGHWAY_CLASSES.join('|')
  return `[out:json][timeout:25];
way["highway"~"^(${classes})$"](${bboxStr});
out geom;`
}

export interface RoadSegment {
  // Stable across tiles (unlike array position), so results from
  // different tiles - a way spanning a tile boundary matches the query in
  // more than one tile - can be deduped by id instead of double-counted.
  id: string
  // [lng, lat] pairs, matching GeoJSON coordinate order (turf expects this).
  coordinates: [number, number][]
}

export function parseRoads(response: OverpassResponse): RoadSegment[] {
  const roads: RoadSegment[] = []

  for (const el of response.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue

    roads.push({
      id: `osm:way:${el.id}`,
      coordinates: el.geometry.map((node) => [node.lon, node.lat])
    })
  }

  return roads
}
