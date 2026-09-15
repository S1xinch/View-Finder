import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  DEFAULT_VIEW,
  GEOLOCATED_INITIAL_ZOOM,
  MAP_STYLE_URL,
  addSatelliteLayer,
  applyAppleStyleTweaks,
  applyDarkMapTweaks,
  boostRoadContrast,
  setSatelliteVisible
} from './mapStyle'
import { LocateControl } from './LocateControl'
import { SatelliteControl } from './SatelliteControl'
import { useViewFinderStore } from '../state/store'

// maplibre-gl's own worker-URL auto-detection (its web_worker.ts) only
// trusts a plain http(s) page origin - it regex-checks `/^https?:/` against
// import.meta.url and silently gives up otherwise, returning an empty
// string. That empty string then gets treated as "same-origin, use
// directly", so `new Worker('')` resolves against the *document's own*
// URL (index.html) instead of a real worker script - which is exactly why
// the map never rendered once packaged (served over the custom app://
// scheme from protocol.ts, not http/https): the browser tried to load
// index.html as the worker's module script and rejected it for having the
// wrong (text/html) MIME type. Setting the worker URL explicitly, resolved
// to a real Vite-emitted asset at build time, bypasses that broken
// detection entirely - works identically in dev (http://localhost) and
// packaged (app://) alike.
setWorkerUrl(maplibreWorkerUrl)

export function MapView(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const setMap = useViewFinderStore((s) => s.setMap)
  const satelliteView = useViewFinderStore((s) => s.satelliteView)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      attributionControl: { compact: true }
    })

    // Always added to MapLibre's bottom-right corner - the mobile
    // relocation (clear of the bottom-sheet sidebar) is done entirely in
    // CSS (see .maplibregl-ctrl-bottom-right's mobile rule in global.css)
    // rather than decided here at mount, so it stays correct across an
    // in-session orientation change/resize instead of freezing whatever
    // was true the moment the map was created.
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new SatelliteControl(), 'bottom-right')
    map.addControl(new LocateControl(), 'bottom-right')

    const applyBaseStyleTweaks = (): void => {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        applyDarkMapTweaks(map)
      } else {
        boostRoadContrast(map)
        applyAppleStyleTweaks(map)
      }
    }
    const applyStyleTweaks = (): void => {
      applyBaseStyleTweaks()
      addSatelliteLayer(map)
      setSatelliteVisible(map, useViewFinderStore.getState().satelliteView)
    }
    if (map.isStyleLoaded()) applyStyleTweaks()
    else map.once('load', applyStyleTweaks)
    mapRef.current = map
    setMap(map)

    // Silent, one-shot "roughly where is the user" lookup to settle on a
    // relevant starting view - separate from the explicit locate-me
    // control (LocateControl.ts/useGeolocation.ts), which keeps watching
    // position and shows the blue tracking dot; this is a single read
    // that only ever moves the camera once, right at load, and never
    // turns tracking on or surfaces an error if it fails/is denied - the
    // world view already showing (DEFAULT_VIEW) is a perfectly fine
    // fallback, not a failure state worth bothering the user about.
    let cancelled = false
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return
          map.easeTo({
            center: [position.coords.longitude, position.coords.latitude],
            zoom: GEOLOCATED_INITIAL_ZOOM,
            duration: 1200
          })
        },
        () => {
          // Denied, unavailable, or timed out - stay on the world view.
        },
        { maximumAge: 5 * 60 * 1000, timeout: 8_000 }
      )
    }

    // Repaints the map's own base colors to follow the OS-level light/dark
    // setting, the same way the rest of the app's chrome already does via
    // CSS (see global.css's prefers-color-scheme rules) - repainting the
    // existing style's layers rather than swapping to a whole separate
    // dark style URL, since OpenFreeMap doesn't publish one and reusing
    // the already-loaded style avoids a second vector-tile fetch.
    const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const onColorSchemeChange = (): void => {
      if (map.isStyleLoaded()) applyBaseStyleTweaks()
    }
    colorSchemeQuery.addEventListener('change', onColorSchemeChange)

    return () => {
      cancelled = true
      colorSchemeQuery.removeEventListener('change', onColorSchemeChange)
      setMap(null)
      map.remove()
      mapRef.current = null
    }
  }, [setMap])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const applyVisibility = (): void => setSatelliteVisible(map, satelliteView)
    if (map.isStyleLoaded()) applyVisibility()
    else map.once('load', applyVisibility)
  }, [satelliteView])

  return <div ref={containerRef} className="map-view" />
}
