import { useEffect, useRef } from 'react'
import { Marker } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'

function buildLocationDotElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'location-dot'
  el.innerHTML = '<div class="location-dot__pulse"></div><div class="location-dot__core"></div>'
  return el
}

// Renders the pulsing blue "you are here" dot while GPS tracking is on -
// see useGeolocation.ts (the Web Geolocation watch that feeds userLocation)
// and LocateControl.ts (the map button that toggles tracking on/off).
export function LocationLayer(): null {
  const map = useViewFinderStore((s) => s.map)
  const tracking = useViewFinderStore((s) => s.locationTracking)
  const userLocation = useViewFinderStore((s) => s.userLocation)
  const markerRef = useRef<Marker | null>(null)
  const hasCenteredRef = useRef(false)

  useEffect(() => {
    if (!map) return

    if (!tracking || !userLocation) {
      markerRef.current?.remove()
      markerRef.current = null
      hasCenteredRef.current = false
      return
    }

    if (!markerRef.current) {
      markerRef.current = new Marker({ element: buildLocationDotElement(), anchor: 'center' })
        .setLngLat([userLocation.lng, userLocation.lat])
        .addTo(map)
    } else {
      markerRef.current.setLngLat([userLocation.lng, userLocation.lat])
    }

    // Center on the user's location once per tracking session, not on every
    // position update - otherwise panning away while tracking stays on
    // would get yanked back on the next GPS fix.
    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true
      map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: Math.max(map.getZoom(), 13), duration: 800 })
    }
  }, [map, tracking, userLocation])

  useEffect(() => {
    return () => {
      markerRef.current?.remove()
      markerRef.current = null
    }
  }, [map])

  return null
}
