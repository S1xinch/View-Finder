import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  DEFAULT_VIEW,
  MAP_STYLE_URL,
  addSatelliteLayer,
  applyAppleStyleTweaks,
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

    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new SatelliteControl(), 'bottom-right')
    map.addControl(new LocateControl(), 'bottom-right')

    const applyStyleTweaks = (): void => {
      boostRoadContrast(map)
      applyAppleStyleTweaks(map)
      addSatelliteLayer(map)
      setSatelliteVisible(map, useViewFinderStore.getState().satelliteView)
    }
    if (map.isStyleLoaded()) applyStyleTweaks()
    else map.once('load', applyStyleTweaks)
    mapRef.current = map
    setMap(map)

    return () => {
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
