import { useEffect, useRef } from 'react'
import { Marker } from 'maplibre-gl'
import { bearing } from '@turf/turf'
import { useViewFinderStore } from '../state/store'

// Below this, two consecutive GPS fixes are more likely sensor jitter than
// real movement - a bearing computed from a few centimeters of drift would
// make the heading wedge spin randomly while the user is stopped.
const MIN_MOVEMENT_FOR_BEARING_METERS = 3
const NAVIGATION_ZOOM = 17

function buildLocationDotElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'location-dot'
  el.innerHTML =
    '<div class="location-dot__pulse"></div><div class="location-dot__heading"></div><div class="location-dot__core"></div>'
  return el
}

// Renders the pulsing blue "you are here" dot while GPS tracking is on -
// see useGeolocation.ts (the Web Geolocation watch that feeds userLocation)
// and LocateControl.ts (the map button that toggles tracking on/off). Also
// owns the camera while turn-by-turn navigation is active (store's
// `navigating`, set by DirectionsView's Start button): instead of centering
// once, it re-centers and zooms in on every GPS fix, and rotates a heading
// wedge on the dot toward whichever way the last fix moved.
export function LocationLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const tracking = useViewFinderStore((s) => s.locationTracking)
  const userLocation = useViewFinderStore((s) => s.userLocation)
  const navigating = useViewFinderStore((s) => s.navigating)
  const markerRef = useRef<Marker | null>(null)
  const hasCenteredRef = useRef(false)
  const lastFixRef = useRef<{ lat: number; lng: number } | null>(null)
  const headingRef = useRef(0)

  useEffect(() => {
    if (!map) return

    if (!tracking || !userLocation) {
      markerRef.current?.remove()
      markerRef.current = null
      hasCenteredRef.current = false
      lastFixRef.current = null
      return
    }

    if (!markerRef.current) {
      markerRef.current = new Marker({ element: buildLocationDotElement(), anchor: 'center' })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([userLocation.lng, userLocation.lat])
    }

    const headingEl = markerRef.current.getElement().querySelector<HTMLDivElement>('.location-dot__heading')
    if (headingEl) {
      const from = lastFixRef.current
      if (navigating && from) {
        const moved = Math.hypot(userLocation.lat - from.lat, userLocation.lng - from.lng) * 111_000
        if (moved >= MIN_MOVEMENT_FOR_BEARING_METERS) {
          headingRef.current = bearing([from.lng, from.lat], [userLocation.lng, userLocation.lat])
        }
      }
      headingEl.style.display = navigating ? 'block' : 'none'
      headingEl.style.transform = `rotate(${headingRef.current}deg)`
    }
    lastFixRef.current = { lat: userLocation.lat, lng: userLocation.lng }

    if (navigating) {
      // Re-centers on every fix (a manual pan away gets pulled back on the
      // next GPS update) - a "recenter" affordance for the driver to pan
      // freely mid-nav is a real gap, just not one worth the extra state
      // for a first version of this.
      map.easeTo({ center: [userLocation.lng, userLocation.lat], zoom: NAVIGATION_ZOOM, duration: 500 })
      return
    }

    // Center on the user's location once per tracking session, not on every
    // position update - otherwise panning away while tracking stays on
    // would get yanked back on the next GPS fix.
    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true
      map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: Math.max(map.getZoom(), 13), duration: 800 })
    }
  }, [map, tracking, userLocation, navigating])

  useEffect(() => {
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
    }
  }, [map])

  return null
}
