import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { DEFAULT_VIEW, MAP_STYLE_URL, applyAppleStyleTweaks, boostRoadContrast } from './mapStyle'
import { LocateControl } from './LocateControl'
import { useViewFinderStore } from '../state/store'

export function MapView(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const setMap = useViewFinderStore((s) => s.setMap)

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
    map.addControl(new LocateControl(), 'bottom-right')

    const applyStyleTweaks = (): void => {
      boostRoadContrast(map)
      applyAppleStyleTweaks(map)
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

  return <div ref={containerRef} className="map-view" />
}
