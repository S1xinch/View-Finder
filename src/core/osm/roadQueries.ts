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
  // [lng, lat] pairs, matching GeoJSON coordinate order (turf expects this).
  coordinates: [number, number][]
}

export function parseRoads(response: OverpassResponse): RoadSegment[] {
  const roads: RoadSegment[] = []

  for (const el of response.elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue

    roads.push({
      coordinates: el.geometry.map((node) => [node.lon, node.lat])
    })
  }

  return roads
}

// Gates on the same car-accessible roads - a gated fire trail is the
// difference between "drive to it" and "walk the last 3km", so these get
// drawn on the map (see renderer/map/GateLayer.tsx). Garden/footpath gates
// are left out by only matching nodes that belong to those roads.
export function buildGateQuery(bbox: BBox): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  const classes = CAR_ACCESSIBLE_HIGHWAY_CLASSES.join('|')
  return `[out:json][timeout:25];
way["highway"~"^(${classes})$"](${bboxStr});
node(w)["barrier"~"^(gate|lift_gate|swing_gate)$"];
out;`
}

export interface Gate {
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
    const closed = tags.locked === 'yes' || [tags.access, tags.motor_vehicle].some((v) => v === 'no' || v === 'private')
    gates.push({ lat: el.lat, lng: el.lon, closed })
  }
  return gates
}
