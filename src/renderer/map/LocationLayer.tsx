import { useEffect, useRef } from 'react'
import { Marker } from 'maplibre-gl'
import { bearing } from '@turf/turf'
import { useViewFinderStore } from '../state/store'
import { visibleCenterOffset } from './mapInsets'

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
// once, it re-centers, zooms in, and rotates the whole map to face whichever
// way the last fix moved (Apple/Google Maps' driving-mode convention) - the
// dot's own heading wedge just points straight up in that mode, since the
// map rotation already encodes the direction; it only needs its own CSS
// rotation for the (non-navigating) plain compass-up view.
export function LocationLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const tracking = useViewFinderStore((s) => s.locationTracking)
  const userLocation = useViewFinderStore((s) => s.userLocation)
  const navigating = useViewFinderStore((s) => s.navigating)
  const markerRef = useRef<Marker | null>(null)
  const hasCenteredRef = useRef(false)
  const lastFixRef = useRef<{ lat: number; lng: number } | null>(null)
  const headingRef = useRef(0)
  const wasNavigatingRef = useRef(false)

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

    const from = lastFixRef.current
    if (navigating && from) {
      const moved = Math.hypot(userLocation.lat - from.lat, userLocation.lng - from.lng) * 111_000
      if (moved >= MIN_MOVEMENT_FOR_BEARING_METERS) {
        headingRef.current = bearing([from.lng, from.lat], [userLocation.lng, userLocation.lat])
      }
    }
    lastFixRef.current = { lat: userLocation.lat, lng: userLocation.lng }

    const headingEl = markerRef.current.getElement().querySelector<HTMLDivElement>('.location-dot__heading')
    if (headingEl) {
      headingEl.style.display = navigating ? 'block' : 'none'
      // While navigating, the map itself rotates to headingRef.current (see
      // easeTo below), so "up" on screen already means "the way you're
      // facing" - the wedge just needs to point straight up on top of that,
      // not rotate a second time on top of the map's own rotation.
      headingEl.style.transform = 'rotate(0deg)'
    }

    const pulseEl = markerRef.current.getElement().querySelector<HTMLDivElement>('.location-dot__pulse')
    if (pulseEl) {
      // Signal strength: poor GPS accuracy (>30m) dims the pulse,
      // good accuracy (<5m) shows it bright. Linear fade over 5-30m range.
      const accuracy = userLocation.accuracyMeters
      const opacity = accuracy < 5 ? 1 : accuracy > 30 ? 0.3 : 1 - ((accuracy - 5) / 25) * 0.7
      pulseEl.style.opacity = String(opacity)
    }

    if (navigating) {
      // Re-centers and re-rotates on every fix (a manual pan/rotate away
      // gets pulled back on the next GPS update) - a "recenter" affordance
      // for the driver to look around freely mid-nav is a real gap, just
      // not one worth the extra state for a first version of this.
      map.easeTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: NAVIGATION_ZOOM,
        bearing: headingRef.current,
        offset: visibleCenterOffset(map),
        duration: 500
      })
      wasNavigatingRef.current = true
      return
    }

    // Coming out of navigation - hand the compass back to north-up rather
    // than leaving the camera stuck at whatever heading the drive ended on.
    // Also satisfies the "center once" flyTo below: the camera is already
    // centered on the user from navigation's own follow-camera, so letting
    // that flyTo additionally fire here would start a second, conflicting
    // camera animation (flyTo doesn't touch bearing, so it would re-assert
    // whatever heading was still active at the exact moment it was called,
    // fighting the bearing reset above for whichever animation loses).
    if (wasNavigatingRef.current) {
      wasNavigatingRef.current = false
      hasCenteredRef.current = true
      map.easeTo({ bearing: 0, duration: 500 })
    }

    // Center on the user's location once per tracking session, not on every
    // position update - otherwise panning away while tracking stays on
    // would get yanked back on the next GPS fix.
    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true
      map.flyTo({
        center: [userLocation.lng, userLocation.lat],
        zoom: Math.max(map.getZoom(), 13),
        offset: visibleCenterOffset(map),
        duration: 800
      })
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
