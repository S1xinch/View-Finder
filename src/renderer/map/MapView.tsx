import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { DEFAULT_VIEW, MAP_STYLE_URL, boostRoadContrast } from './mapStyle'
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
    if (map.isStyleLoaded()) boostRoadContrast(map)
    else map.once('load', () => boostRoadContrast(map))
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
