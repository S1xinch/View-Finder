import { useEffect } from 'react'
import type { GeoJSONSource } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'
import type { Gate } from '@shared/ipcContract'

const SOURCE_ID = 'gates'
const LAYER_ID = 'gates'
// Gates only mean anything at street level; below this a single fetch
// would also cover far too many tiles.
const MIN_ZOOM = 13
const DEBOUNCE_MS = 1000
const ICON_PIXEL_RATIO = 2

// Small rounded badge with a white two-bar gate, Organic Maps style.
// Amber = gate, red = locked / no public access.
function buildGateIcon(color: string): { width: number; height: number; data: Uint8ClampedArray } {
  const size = 18 * ICON_PIXEL_RATIO
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) }

  ctx.scale(ICON_PIXEL_RATIO, ICON_PIXEL_RATIO)
  ctx.fillStyle = color
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(1, 1, 16, 16, 4)
  ctx.fill()
  ctx.stroke()

  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const x of [5, 13]) {
    ctx.moveTo(x, 4.5)
    ctx.lineTo(x, 13.5)
  }
  for (const y of [7, 11]) {
    ctx.moveTo(5, y)
    ctx.lineTo(13, y)
  }
  ctx.stroke()

  return { width: size, height: size, data: ctx.getImageData(0, 0, size, size).data }
}

function toFeatureCollection(gates: Gate[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: gates.map((g) => ({
      type: 'Feature',
      properties: { icon: g.closed ? 'gate-closed' : 'gate-open' },
      geometry: { type: 'Point', coordinates: [g.lng, g.lat] }
    }))
  }
}

// Gates on car-accessible roads (see core/osm/roadQueries.ts), refetched
// for the viewport after each pan settles. Cached per tile in core/, so
// panning back over the same area is free.
export function GateLayer(): null {
  const map = useViewFinderStore((s) => s.map)

  useEffect(() => {
    if (!map) return

    if (!map.hasImage('gate-open')) map.addImage('gate-open', buildGateIcon('#c98a1b'), { pixelRatio: ICON_PIXEL_RATIO })
    if (!map.hasImage('gate-closed')) map.addImage('gate-closed', buildGateIcon('#c2452d'), { pixelRatio: ICON_PIXEL_RATIO })
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: toFeatureCollection([]) })
      map.addLayer({
        id: LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: MIN_ZOOM,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.75, 16, 1]
        }
      })
    }

    let debounce: ReturnType<typeof setTimeout> | undefined
    let latest = 0
    const fetchForView = (): void => {
      if (map.getZoom() < MIN_ZOOM || !window.viewFinderAPI?.getGates) return
      const b = map.getBounds()
      const request = ++latest
      window.viewFinderAPI
        .getGates({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() })
        .then((gates) => {
          if (request === latest) (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(toFeatureCollection(gates))
        })
        .catch((error: unknown) => console.warn('[GateLayer] getGates failed', error))
    }
    const onMoveEnd = (): void => {
      clearTimeout(debounce)
      debounce = setTimeout(fetchForView, DEBOUNCE_MS)
    }

    fetchForView()
    map.on('moveend', onMoveEnd)
    return () => {
      map.off('moveend', onMoveEnd)
      clearTimeout(debounce)
    }
  }, [map])

  return null
}
