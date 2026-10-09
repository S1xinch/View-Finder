import type { BBox } from '../geo/types'
import { isPointInBBox } from '../geo/tiling'
import type { Gate, RoadSegment } from '../osm/roadQueries'
import { distanceToNearestRoadMeters, MAX_WALK_IN_METERS } from './roadReachability'

const METERS_PER_DEGREE = 111_320

// Whether a spot is out of walking range of every road you can drive onto
// from the public network without passing a locked/private gate or using a
// private road.
//
// Roads are joined into connected pieces by shared OSM node ids, cutting
// at closed gates and leaving private roads out. A piece counts as public
// if it has a through road (anything but a track/service road) or runs
// off the edge of the loaded area - the data stops there, so assume it
// joins the wider network. Only as good as OSM's gate/access tagging.
export function buildGatedCheck(
  roads: RoadSegment[],
  gates: Gate[],
  bbox: BBox
): (spot: { lat: number; lng: number }) => boolean {
  if (!roads.some((r) => r.nodeIds)) return () => false

  const closed = new Set(gates.filter((g) => g.closed).map((g) => g.id))
  const parent = new Map<number, number>()
  const find = (id: number): number => {
    let root = id
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
    parent.set(id, root)
    return root
  }

  const open = roads.filter((r) => r.nodeIds && !r.private)
  for (const road of open) {
    const ids = road.nodeIds!
    for (let i = 0; i < ids.length - 1; i++) {
      if (closed.has(ids[i]) || closed.has(ids[i + 1])) continue
      parent.set(find(ids[i]), find(ids[i + 1]))
    }
  }

  const publicRoots = new Set<number>()
  for (const road of open) {
    road.nodeIds!.forEach((id, i) => {
      if (closed.has(id)) return
      const [lng, lat] = road.coordinates[i]
      if (!road.minor || !isPointInBBox({ lat, lng }, bbox)) publicRoots.add(find(id))
    })
  }

  // The drivable parts of each road, as runs of consecutive segments (a
  // segment ending at a closed gate still counts from its public side).
  const drivable: { road: RoadSegment; west: number; south: number; east: number; north: number }[] = []
  for (const road of open) {
    const ids = road.nodeIds!
    let run: [number, number][] = []
    const flush = (): void => {
      if (run.length < 2) return
      const lngs = run.map((c) => c[0])
      const lats = run.map((c) => c[1])
      drivable.push({
        road: { coordinates: run },
        west: Math.min(...lngs),
        east: Math.max(...lngs),
        south: Math.min(...lats),
        north: Math.max(...lats)
      })
    }
    for (let i = 0; i < ids.length - 1; i++) {
      const reachable = [ids[i], ids[i + 1]].some((id) => !closed.has(id) && publicRoots.has(find(id)))
      if (reachable) {
        if (run.length === 0) run.push(road.coordinates[i])
        run.push(road.coordinates[i + 1])
      } else {
        flush()
        run = []
      }
    }
    flush()
  }

  return (spot) => {
    const dLat = MAX_WALK_IN_METERS / METERS_PER_DEGREE
    const dLng = dLat / Math.cos((spot.lat * Math.PI) / 180)
    const nearby = drivable
      .filter((d) => d.west <= spot.lng + dLng && d.east >= spot.lng - dLng && d.south <= spot.lat + dLat && d.north >= spot.lat - dLat)
      .map((d) => d.road)
    const distance = distanceToNearestRoadMeters(spot, nearby)
    return distance === null || distance > MAX_WALK_IN_METERS
  }
}
