import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
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
