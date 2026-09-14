import { useEffect } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'
import type { RouteResult } from '@shared/ipcContract'

const SOURCE_ID = 'route'
const CASING_LAYER_ID = 'route-casing'
const LINE_LAYER_ID = 'route-line'

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function toFeatureCollection(route: RouteResult | null): GeoJSON.FeatureCollection {
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

// Renders the active driving route (see useRoute.ts) as a highlighted line
// - a white casing underneath a solid accent-colored line on top, the same
// two-layer treatment turn-by-turn map apps use to make the route stand out
// against the basemap's own roads.
export function RouteLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const route = useViewFinderStore((s) => s.route)

  useEffect(() => {
    if (!map) return

    const data = toFeatureCollection(route)

    const addLayers = (): void => {
      if (map.getSource(SOURCE_ID)) return

      map.addSource(SOURCE_ID, { type: 'geojson', data })
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

    const updateData = (): void => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      if (source) source.setData(data)
      else addLayers()
    }

    if (map.isStyleLoaded()) updateData()
    else map.once('load', updateData)
  }, [map, route])

  useEffect(() => {
    if (!map || !route) return
    const coords = route.coordinates
    if (coords.length === 0) return

    let west = coords[0][0]
    let east = coords[0][0]
    let south = coords[0][1]
    let north = coords[0][1]
    for (const [lng, lat] of coords) {
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
  }, [map, route])

  return null
}
