import { useEffect } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'
import type { RouteResult, Viewpoint } from '@shared/ipcContract'

const SOURCE_ID = 'route'
const CASING_LAYER_ID = 'route-casing'
const LINE_LAYER_ID = 'route-line'
const WALK_SOURCE_ID = 'route-walk'
const WALK_LAYER_ID = 'route-walk-line'

// OSRM snaps the route endpoint to the nearest point actually on the road
// network - a viewpoint/peak that isn't right on a road (see
// roadReachability.ts's walk-in allowance) always ends up a short distance
// from where the route line stops. Below this, the gap is close enough to
// be noise (GPS/snapping jitter) and not worth drawing a separate segment
// for.
const MIN_WALK_GAP_METERS = 15

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function haversineDistanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function toRouteFeatureCollection(route: RouteResult | null): GeoJSON.FeatureCollection {
  if (!route) return EMPTY_FEATURE_COLLECTION
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: route.coordinates }
      }
    ]
  }
}

// The last road-network point the route reaches, and the walk-in gap (if
// any) from there to the actual destination - the dashed segment drawn
// below makes that last stretch visible instead of the route just
// appearing to "stop short" with no explanation.
function toWalkFeatureCollection(route: RouteResult | null, destination: Viewpoint | null): GeoJSON.FeatureCollection {
  if (!route || !destination || route.coordinates.length === 0) return EMPTY_FEATURE_COLLECTION

  const roadEnd = route.coordinates[route.coordinates.length - 1]
  const destPoint: [number, number] = [destination.lng, destination.lat]
  if (haversineDistanceMeters(roadEnd, destPoint) < MIN_WALK_GAP_METERS) return EMPTY_FEATURE_COLLECTION

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [roadEnd, destPoint] }
      }
    ]
  }
}

// Renders the active driving route (see useRoute.ts) as a highlighted line
// - a white casing underneath a solid accent-colored line on top, the same
// two-layer treatment turn-by-turn map apps use to make the route stand out
// against the basemap's own roads - plus a dashed "walk-in" segment for any
// gap between where the road ends and the actual spot.
export function RouteLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const route = useViewFinderStore((s) => s.route)
  const routeDestination = useViewFinderStore((s) => s.routeDestination)

  useEffect(() => {
    if (!map) return

    const routeData = toRouteFeatureCollection(route)
    const walkData = toWalkFeatureCollection(route, routeDestination)

    const addLayers = (): void => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: routeData })
        map.addLayer({
          id: CASING_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 }
        })
        map.addLayer({
          id: LINE_LAYER_ID,
          type: 'line',
          source: SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#2f6fed', 'line-width': 5 }
        })
      }

      if (!map.getSource(WALK_SOURCE_ID)) {
        map.addSource(WALK_SOURCE_ID, { type: 'geojson', data: walkData })
        map.addLayer({
          id: WALK_LAYER_ID,
          type: 'line',
          source: WALK_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#2f6fed', 'line-width': 4, 'line-dasharray': [0.5, 1.5] }
        })
      }
    }

    const updateData = (): void => {
      const routeSource = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      const walkSource = map.getSource(WALK_SOURCE_ID) as GeoJSONSource | undefined
      if (routeSource && walkSource) {
        routeSource.setData(routeData)
        walkSource.setData(walkData)
      } else {
        addLayers()
      }
    }

    // No isStyleLoaded()/once('load') guard needed - see the comment on
    // this in ViewpointLayer.tsx (same fix, same underlying bug class).
    // `map` from the store is only ever set once the style has genuinely
    // finished loading (see MapView.tsx's markMapReady).
    updateData()
  }, [map, route, routeDestination])

  useEffect(() => {
    if (!map || !route) return
    const coords = route.coordinates
    if (coords.length === 0) return

    const allCoords = routeDestination ? [...coords, [routeDestination.lng, routeDestination.lat] as [number, number]] : coords

    let west = allCoords[0][0]
    let east = allCoords[0][0]
    let south = allCoords[0][1]
    let north = allCoords[0][1]
    for (const [lng, lat] of allCoords) {
      if (lng < west) west = lng
      if (lng > east) east = lng
      if (lat < south) south = lat
      if (lat > north) north = lat
    }

    map.fitBounds(
      [
        [west, south],
        [east, north]
      ],
      { padding: { top: 60, bottom: 60, left: 360, right: 60 }, duration: 800 }
    )
  }, [map, route, routeDestination])

  return null
}
