import { useEffect, useRef } from 'react'
import { Marker, Popup } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'
import { CATEGORY_COLOR, CATEGORY_LABEL } from './categoryStyle'
import type { Viewpoint } from '@shared/ipcContract'

const DIRECTIONS_BUTTON_CLASS = 'vf-popup__directions'

// Classic map-pin teardrop silhouette (viewBox 0,0,26,34), tip at the
// bottom-center so `anchor: 'bottom'` plants the point exactly on the
// coordinate rather than the shape's bounding-box center.
function buildPinElement(vp: Viewpoint): HTMLDivElement {
  const color = CATEGORY_COLOR[vp.category]
  const el = document.createElement('div')
  el.className = 'vf-pin' + (vp.category === 'computed_peak' ? ' vf-pin--estimated' : '')
  el.innerHTML = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z" fill="${color}" />
    <circle cx="13" cy="12" r="4.5" fill="#ffffff" />
  </svg>`
  return el
}

function buildPopupHtml(vp: Viewpoint): string {
  const elevationLine =
    vp.elevationMeters != null ? `<div class="vf-popup__elevation">${Math.round(vp.elevationMeters)} m</div>` : ''
  const estimateNote =
    vp.category === 'computed_peak'
      ? '<div class="vf-popup__note">Estimated from elevation data, not confirmed on OpenStreetMap.</div>'
      : ''
  return `<div class="vf-popup__title">${vp.name ?? CATEGORY_LABEL[vp.category]}</div><div class="vf-popup__category">${CATEGORY_LABEL[vp.category]}</div>${elevationLine}${estimateNote}<button type="button" class="${DIRECTIONS_BUTTON_CLASS}">Directions</button>`
}

export function ViewpointLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const viewpoints = useViewFinderStore((s) => s.viewpoints)
  const markersRef = useRef<Map<string, Marker>>(new Map())

  useEffect(() => {
    if (!map) return

    const markers = markersRef.current
    const currentIds = new Set(viewpoints.map((vp) => vp.id))

    for (const [id, marker] of markers) {
      if (!currentIds.has(id)) {
        marker.remove()
        markers.delete(id)
      }
    }

    for (const vp of viewpoints) {
      if (markers.has(vp.id)) continue

      const el = buildPinElement(vp)
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const popup = new Popup({ closeButton: true, className: 'vf-popup', offset: 26 })
          .setLngLat([vp.lng, vp.lat])
          .setHTML(buildPopupHtml(vp))
          .addTo(map)

        popup
          .getElement()
          .querySelector(`.${DIRECTIONS_BUTTON_CLASS}`)
          ?.addEventListener('click', () => {
            useViewFinderStore.getState().requestRoute(vp)
            popup.remove()
          })
      })

      const marker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([vp.lng, vp.lat]).addTo(map)
      markers.set(vp.id, marker)
    }
  }, [map, viewpoints])

  // Separate cleanup effect keyed only on `map` - the effect above re-runs
  // on every viewpoints change and must not tear down all markers each time.
  useEffect(() => {
    const markers = markersRef.current
    return () => {
      for (const marker of markers.values()) marker.remove()
      markers.clear()
    }
  }, [map])

  return null
}
