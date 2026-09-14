import { useEffect } from 'react'
import { Popup, type GeoJSONSource } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'
import { CATEGORY_COLOR, CATEGORY_LABEL } from './categoryStyle'
import type { Viewpoint } from '@shared/ipcContract'

const SOURCE_ID = 'viewpoints'
const LAYER_ID = 'viewpoints-layer'

function toFeatureCollection(viewpoints: Viewpoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: viewpoints.map((vp) => ({
      type: 'Feature',
      id: vp.id,
      geometry: { type: 'Point', coordinates: [vp.lng, vp.lat] },
      properties: {
        name: vp.name ?? CATEGORY_LABEL[vp.category],
        category: vp.category,
        elevationMeters: vp.elevationMeters ?? null
      }
    }))
  }
}

export function ViewpointLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const viewpoints = useViewFinderStore((s) => s.viewpoints)

  useEffect(() => {
    if (!map) return

    const data = toFeatureCollection(viewpoints)

    const addLayer = (): void => {
      if (map.getSource(SOURCE_ID)) return

      map.addSource(SOURCE_ID, { type: 'geojson', data })
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': 6,
          'circle-color': [
            'match',
            ['get', 'category'],
            'viewpoint',
            CATEGORY_COLOR.viewpoint,
            'peak',
            CATEGORY_COLOR.peak,
            'alpine_hut',
            CATEGORY_COLOR.alpine_hut,
            'computed_peak',
            CATEGORY_COLOR.computed_peak,
            '#888888'
          ],
          'circle-opacity-transition': { duration: 200 },
          'circle-radius-transition': { duration: 200 },
          'circle-stroke-width': ['match', ['get', 'category'], 'computed_peak', 2.5, 2],
          'circle-stroke-color': '#ffffff'
        }
      })

      map.on('click', LAYER_ID, (e) => {
        const feature = e.features?.[0]
        if (!feature || feature.geometry.type !== 'Point') return
        const props = feature.properties as { name: string; category: string; elevationMeters: number | null }
        const coords = feature.geometry.coordinates as [number, number]
        const category = props.category as Viewpoint['category']
        const elevationLine =
          props.elevationMeters !== null ? `<div class="vf-popup__elevation">${Math.round(props.elevationMeters)} m</div>` : ''
        const estimateNote =
          category === 'computed_peak'
            ? '<div class="vf-popup__note">Estimated from elevation data, not confirmed on OpenStreetMap.</div>'
            : ''

        new Popup({ closeButton: true, className: 'vf-popup', offset: 10 })
          .setLngLat(coords)
          .setHTML(
            `<div class="vf-popup__title">${props.name}</div><div class="vf-popup__category">${CATEGORY_LABEL[category]}</div>${elevationLine}${estimateNote}`
          )
          .addTo(map)
      })

      map.on('mouseenter', LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    const updateData = (): void => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      if (source) source.setData(data)
      else addLayer()
    }

    if (map.isStyleLoaded()) updateData()
    else map.once('load', updateData)
  }, [map, viewpoints])

  return null
}
