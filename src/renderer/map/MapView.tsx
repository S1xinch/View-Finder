import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
  DEFAULT_VIEW,
  MAP_STYLE_URL,
  addSatelliteLayer,
  applyAppleStyleTweaks,
  applyDarkMapTweaks,
  applyTrailMapTweaks,
  boostRoadContrast,
  restoreBasePaint,
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

// Apple follows the OS light/dark setting; Trail and Night are fixed.
function applyThemeToMap(map: MapLibreMap): void {
  const theme = useViewFinderStore.getState().theme
  restoreBasePaint(map)
  if (theme === 'trail') applyTrailMapTweaks(map)
  else if (theme === 'night' || window.matchMedia('(prefers-color-scheme: dark)').matches) applyDarkMapTweaks(map)
  else {
    boostRoadContrast(map)
    applyAppleStyleTweaks(map)
  }
}

export function MapView(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const setMap = useViewFinderStore((s) => s.setMap)
  const satelliteView = useViewFinderStore((s) => s.satelliteView)
  const theme = useViewFinderStore((s) => s.theme)

  useEffect(() => {
    if (mapRef.current) applyThemeToMap(mapRef.current)
  }, [theme])

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

    const applyBaseStyleTweaks = (): void => applyThemeToMap(map)
    // Every other layer component (ViewpointLayer, PrivateLandLayer,
    // RouteLayer) reads `map` from the store and immediately calls
    // addSource/addLayer/source.setData on it - which only actually
    // requires the style to have loaded *once, ever*, not whatever
    // isStyleLoaded() currently reports. isStyleLoaded() also factors in
    // whether the *currently visible* tiles have finished loading, so it
    // routinely flips back to false during ordinary panning, long after
    // the map's 'load' event already fired for good. A component whose
    // own data-update effect happened to run during one of those windows
    // - very likely for ViewpointLayer specifically, since it re-runs on
    // every pan/fetch - would see isStyleLoaded() as false and fall back
    // to map.once('load', ...), a listener that (load being a strictly
    // one-time event) then never fires: the pin layer silently never gets
    // created or updated, even though the fetch succeeded and the store
    // has the data (which is exactly what the sidebar list reads from,
    // so it stays correct while the map goes stale/blank). Delaying
    // setMap() until the style has genuinely finished loading once means
    // every downstream layer component can trust that `map` from the
    // store is always safe to add sources/layers to immediately, with no
    // isStyleLoaded()/once('load') guard of their own needed at all.
    const markMapReady = (): void => {
      applyBaseStyleTweaks()
      addSatelliteLayer(map)
      setSatelliteVisible(map, useViewFinderStore.getState().satelliteView)

      // OpenStreetMap's and OpenFreeMap's terms of use both require this
      // attribution to be shown - it can't just be removed - but MapLibre's
      // compact mode still renders it as an already-*expanded* native
      // <details open> element rather than starting collapsed to just the
      // (i) toggle. Forcing `open = false` here (not right after
      // construction - the control's actual DOM element isn't there yet
      // that early) keeps the attribution, and the native <details>/
      // <summary> tap-to-expand needing no JS of its own, while not
      // permanently taking up space over the map.
      const attributionDetails = map.getContainer().querySelector<HTMLDetailsElement>('.maplibregl-ctrl-attrib')
      if (attributionDetails) attributionDetails.open = false

      mapRef.current = map
      setMap(map)
    }
    if (map.isStyleLoaded()) markMapReady()
    else map.once('load', markMapReady)

    // No silent geolocation lookup on load anymore - this used to fire
    // navigator.geolocation.getCurrentPosition() immediately on mount to
    // recenter the map, which means the browser's own location-permission
    // prompt appeared before the user had done anything at all. Location
    // is now purely opt-in: the map opens on DEFAULT_VIEW and only ever
    // asks for a position when the user taps the explicit locate-me
    // control (LocateControl.ts/useGeolocation.ts).

    // Repaints the map's own base colors to follow the OS-level light/dark
    // setting, the same way the rest of the app's chrome already does via
    // CSS (see global.css's prefers-color-scheme rules) - repainting the
    // existing style's layers rather than swapping to a whole separate
    // dark style URL, since OpenFreeMap doesn't publish one and reusing
    // the already-loaded style avoids a second vector-tile fetch.
    const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    // This can only ever fire after mount, by which point the style has
    // already loaded - no isStyleLoaded() guard needed (and, unlike the
    // spots this comment references elsewhere in this file, this one had
    // no once('load') fallback either: a change landing in one of
    // isStyleLoaded()'s transient false windows during a pan used to just
    // silently skip the repaint for good, never retried).
    const onColorSchemeChange = (): void => applyBaseStyleTweaks()
    colorSchemeQuery.addEventListener('change', onColorSchemeChange)

    return () => {
      colorSchemeQuery.removeEventListener('change', onColorSchemeChange)
      setMap(null)
      map.remove()
      mapRef.current = null
    }
  }, [setMap])

  useEffect(() => {
    const map = mapRef.current
    // mapRef.current is only ever set once the style has genuinely
    // finished loading (see markMapReady above) - no isStyleLoaded()/
    // once('load') guard needed here either.
    if (!map) return
    setSatelliteVisible(map, satelliteView)
  }, [satelliteView])

  return <div ref={containerRef} className="map-view" />
}
