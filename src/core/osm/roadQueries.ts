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

// Roads plus the gates on them, in one query: the gates are drawn on the
// map (renderer/map/GateLayer.tsx) and cut the road network for
// core/scoring/gateReachability.ts. Garden/footpath gates are left out by
// only matching nodes that belong to these roads.
export function buildRoadQuery(bbox: BBox): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  const classes = CAR_ACCESSIBLE_HIGHWAY_CLASSES.join('|')
  return `[out:json][timeout:25];
way["highway"~"^(${classes})$"](${bboxStr});
out geom;
node(w)["barrier"~"^(gate|lift_gate|swing_gate)$"];
out;`
}

const isPrivate = (value: string | undefined): boolean => value === 'no' || value === 'private'

export interface RoadSegment {
  // [lng, lat] pairs, matching GeoJSON coordinate order (turf expects this).
  coordinates: [number, number][]
  // OSM node ids, parallel to coordinates - how roads join up.
  nodeIds?: number[]
  // No public / motor-vehicle access.
  private?: boolean
  // A track or service road rather than a through road.
  minor?: boolean
}

export function parseRoads(response: OverpassResponse): RoadSegment[] {
  const roads: RoadSegment[] = []

  for (const el of response.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue
    const tags = el.tags ?? {}

    roads.push({
      coordinates: el.geometry.map((node) => [node.lon, node.lat]),
      nodeIds: el.nodes?.length === el.geometry.length ? el.nodes : undefined,
      private: isPrivate(tags.access) || isPrivate(tags.motor_vehicle) || isPrivate(tags.motorcar),
      minor: tags.highway === 'track' || tags.highway === 'service'
    })
  }

  return roads
}

export interface Gate {
  id: number
  lat: number
  lng: number
  // Tagged locked, or no public access - the gate you likely can't open.
  closed: boolean
}

export function parseGates(response: OverpassResponse): Gate[] {
  const gates: Gate[] = []
  for (const el of response.elements) {
    if (el.type !== 'node' || el.lat === undefined || el.lon === undefined) continue
    const tags = el.tags ?? {}
    const closed = tags.locked === 'yes' || isPrivate(tags.access) || isPrivate(tags.motor_vehicle)
    gates.push({ id: el.id, lat: el.lat, lng: el.lon, closed })
  }
  return gates
}
