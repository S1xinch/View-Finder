import { useEffect } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'
import type { ExcludedLandArea } from '@shared/ipcContract'

const SOURCE_ID = 'excluded-land'
const FILL_LAYER_ID = 'excluded-land-fill'
const OUTLINE_LAYER_ID = 'excluded-land-outline'

function toFeatureCollection(areas: ExcludedLandArea[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: areas.map((area) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [area.ring] }
    }))
  }
}

// Renders farmland/private-access polygons candidates got excluded for
// landing inside (see core/scoring/landUseFilter.ts) - shown only while
// the "Show private land" toggle is on (see the Sidebar checkbox and
// usePrivateLandSync, which populates this data).
export function PrivateLandLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const showPrivateLand = useViewFinderStore((s) => s.showPrivateLand)
  const excludedLandAreas = useViewFinderStore((s) => s.excludedLandAreas)

  useEffect(() => {
    if (!map) return

    const data = toFeatureCollection(excludedLandAreas)

    const addLayers = (): void => {
      if (map.getSource(SOURCE_ID)) return

      map.addSource(SOURCE_ID, { type: 'geojson', data })
      map.addLayer({
        id: FILL_LAYER_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: { 'fill-color': '#c2452d', 'fill-opacity': 0.16 }
      })
      map.addLayer({
        id: OUTLINE_LAYER_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#c2452d', 'line-width': 1.5, 'line-opacity': 0.6 }
      })
    }

    const updateData = (): void => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      if (source) source.setData(data)
      else addLayers()
    }

    // No isStyleLoaded()/once('load') guard needed - see the comment on
    // this in ViewpointLayer.tsx (same fix, same underlying bug class:
    // isStyleLoaded() can go false again during an ordinary pan long
    // after the map's one-time 'load' event already fired, and a
    // once('load') fallback registered after that point then never
    // fires). `map` from the store is only ever set once the style has
    // genuinely finished loading (see MapView.tsx's markMapReady).
    updateData()
  }, [map, excludedLandAreas])

  useEffect(() => {
    if (!map) return

    const visibility = showPrivateLand ? 'visible' : 'none'
    if (map.getLayer(FILL_LAYER_ID)) map.setLayoutProperty(FILL_LAYER_ID, 'visibility', visibility)
    if (map.getLayer(OUTLINE_LAYER_ID)) map.setLayoutProperty(OUTLINE_LAYER_ID, 'visibility', visibility)
  }, [map, showPrivateLand])

  return null
}
