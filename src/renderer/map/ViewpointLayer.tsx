import { useEffect, useRef } from 'react'
import { Popup } from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'
import { CATEGORY_LABEL } from './categoryStyle'
import { CATEGORY_COLORS } from '../themes'
import { buildExternalMapsUrl } from '../utils/mapLinks'
import type { Viewpoint, ViewpointCategory } from '@shared/ipcContract'

const SOURCE_ID = 'viewpoints'
const LAYER_ID = 'viewpoints-pins'
const DIRECTIONS_BUTTON_CLASS = 'vf-popup__directions'
const OPEN_IN_MAPS_BUTTON_CLASS = 'vf-popup__open-in-maps'

// Capped at 3x - a pin only needs to look crisp, not consume 4x+ the
// raster memory on very-high-DPI devices for no visible benefit.
const PIN_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 3)

function iconIdFor(category: ViewpointCategory): string {
  return `vf-pin-${category}`
}

// Same teardrop silhouette (viewBox 0,0,26,34) the old per-marker DOM
// element used, now rasterized once per category and registered as a
// MapLibre image instead of built as a real DOM element for every pin.
// Hundreds of DOM markers each need repositioning via a synchronous
// main-thread style write on *every* pan/zoom frame - a well-known
// MapLibre performance trap, and the actual cause of "pins lag behind
// while panning quickly". A symbol layer's icons are drawn from a single
// GPU buffer alongside the rest of the map, with zero per-marker
// main-thread work during a pan - the map's own basemap tiles already
// render this way. The drop-shadow is baked into the raster (canvas
// shadow* properties) since a symbol layer can't apply a CSS filter per
// icon the way the old DOM version's .vf-pin class did.
function buildPinIcon(color: string, pixelRatio: number): { width: number; height: number; data: Uint8ClampedArray } {
  const width = Math.round(26 * pixelRatio)
  const height = Math.round(34 * pixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  // Only fails in a context without 2D canvas support at all (never in
  // any real browser this app targets) - an empty transparent icon is a
  // harmless fallback rather than a hard crash.
  if (!ctx) return { width, height, data: new Uint8ClampedArray(width * height * 4) }

  ctx.scale(pixelRatio, pixelRatio)
  const pinPath = new Path2D('M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z')

  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 2
  ctx.fillStyle = color
  ctx.fill(pinPath)
  ctx.restore()

  ctx.beginPath()
  ctx.arc(13, 12, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()

  return { width, height, data: ctx.getImageData(0, 0, width, height).data }
}

function toFeatureCollection(viewpoints: Viewpoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: viewpoints.map((vp) => ({
      type: 'Feature',
      // vp.id is a string like "osm:node:12345" - GeoJSON sources require
      // integer feature ids internally (geojson-vt) and silently replace any
      // non-integer id with an auto-generated sequential one, so a real click
      // handler reading e.features[0].id back would never see this value.
      // Carried in properties instead, which preserve arbitrary strings as-is.
      properties: { id: vp.id, icon: iconIdFor(vp.category), estimated: vp.category === 'computed_peak' },
      geometry: { type: 'Point', coordinates: [vp.lng, vp.lat] }
    }))
  }
}

function buildPopupHtml(vp: Viewpoint): string {
  const elevationLine =
    vp.elevationMeters != null ? `<div class="vf-popup__elevation">${Math.round(vp.elevationMeters)} m</div>` : ''
  const estimateNote =
    vp.category === 'computed_peak'
      ? '<div class="vf-popup__note">Estimated from elevation data, not confirmed on OpenStreetMap.</div>'
      : ''
  return `<div class="vf-popup__title">${vp.name ?? CATEGORY_LABEL[vp.category]}</div><div class="vf-popup__category">${CATEGORY_LABEL[vp.category]}</div>${elevationLine}${estimateNote}<div class="vf-popup__actions"><button type="button" class="${DIRECTIONS_BUTTON_CLASS}">Directions</button><button type="button" class="${OPEN_IN_MAPS_BUTTON_CLASS}">Open in Maps</button></div>`
}

export function ViewpointLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const viewpoints = useViewFinderStore((s) => s.viewpoints)
  const theme = useViewFinderStore((s) => s.theme)
  // The click/hover listeners below are registered once (inside the
  // layer-creation branch, which only runs the first time) rather than
  // re-subscribed on every viewpoints change - they read the *current*
  // list through this ref instead, the same pattern useViewpoints.ts uses
  // for its own map reference.
  const viewpointsRef = useRef<Viewpoint[]>(viewpoints)
  viewpointsRef.current = viewpoints

  useEffect(() => {
    if (!map) return

    const data = toFeatureCollection(viewpoints)

    const addLayer = (): void => {
      if (map.getSource(SOURCE_ID)) return

      const colors = CATEGORY_COLORS[useViewFinderStore.getState().theme]
      for (const category of Object.keys(colors) as ViewpointCategory[]) {
        const id = iconIdFor(category)
        if (!map.hasImage(id)) map.addImage(id, buildPinIcon(colors[category], PIN_PIXEL_RATIO), { pixelRatio: PIN_PIXEL_RATIO })
      }

      map.addSource(SOURCE_ID, { type: 'geojson', data })
      map.addLayer({
        id: LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-anchor': 'bottom',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true
          // No hover-grow effect: MapLibre 6.x rejects `feature-state`
          // expressions on layout properties (icon-size is layout-only,
          // with no paint equivalent) - map.addLayer() throws synchronously
          // if this is attempted, which silently kills pin rendering for
          // the rest of the session (the source gets created, the layer
          // never does, and every later update just calls source.setData()
          // on a layer-less source). Cursor-change on hover (below) is
          // sufficient affordance without touching a restricted property.
        },
        paint: {
          // Matches the old .vf-pin--estimated { opacity: 0.88 } for
          // computed (not OSM-tagged) peaks.
          'icon-opacity': ['case', ['get', 'estimated'], 0.88, 1]
        }
      })

      map.on('mousemove', LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
      })

      map.on('click', LAYER_ID, (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined
        const vp = id == null ? undefined : viewpointsRef.current.find((v) => v.id === id)
        if (!vp) return

        e.originalEvent.stopPropagation()
        const popup = new Popup({ closeButton: true, className: 'vf-popup', offset: 26 })
          .setLngLat([vp.lng, vp.lat])
          .setHTML(buildPopupHtml(vp))
          .addTo(map)

        const popupEl = popup.getElement()
        popupEl.querySelector(`.${DIRECTIONS_BUTTON_CLASS}`)?.addEventListener('click', () => {
          useViewFinderStore.getState().requestRoute(vp)
          popup.remove()
        })
        popupEl.querySelector(`.${OPEN_IN_MAPS_BUTTON_CLASS}`)?.addEventListener('click', () => {
          window.open(buildExternalMapsUrl({ lat: vp.lat, lng: vp.lng }, vp.name), '_blank', 'noopener')
        })
      })
    }

    const updateData = (): void => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
      if (source) source.setData(data)
      else addLayer()
    }

    // No isStyleLoaded()/once('load') guard needed - `map` from the store
    // is only ever set once the style has genuinely finished loading (see
    // MapView.tsx's markMapReady), so it's always safe to touch sources/
    // layers immediately. That guard used to be exactly the bug behind
    // "the pins don't load sometimes": isStyleLoaded() also reflects
    // whether the *currently visible* tiles have finished loading, so it
    // routinely goes false again during an ordinary pan long after the
    // map's one-time 'load' event already fired - and since this effect
    // re-runs on every single pan/fetch, it was the layer most likely to
    // have a data update land in exactly that window, falling back to a
    // map.once('load', ...) listener that (load being one-time) then
    // never fires: the fetch succeeds and the store gets the data (which
    // is what the sidebar list reads from, so it stayed correct) but the
    // map layer itself silently never gets created or updated.
    updateData()
  }, [map, viewpoints])

  // Repaints the existing pin images in place when the theme changes -
  // same size, so updateImage works and the layer itself is untouched.
  useEffect(() => {
    if (!map) return
    const colors = CATEGORY_COLORS[theme]
    for (const category of Object.keys(colors) as ViewpointCategory[]) {
      const id = iconIdFor(category)
      if (map.hasImage(id)) map.updateImage(id, buildPinIcon(colors[category], PIN_PIXEL_RATIO))
    }
  }, [map, theme])

  useEffect(() => {
    if (!map) return
    return () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    }
  }, [map])

  return null
}
