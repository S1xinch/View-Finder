import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Viewpoint } from '@shared/ipcContract'

// Wait for panning/zooming to settle before fetching, so rapid movement
// doesn't fire a burst of IPC calls that each fan out to Overpass.
const DEBOUNCE_MS = 500

export function useViewpoints(map: MapLibreMap | null): Viewpoint[] {
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!map) return

    const fetchForCurrentView = (): void => {
      const bounds = map.getBounds()
      window.viewFinderAPI
        .getViewpoints({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth()
        })
        .then(setViewpoints)
        .catch((error: unknown) => console.error('Failed to load viewpoints', error))
    }

    const onMoveEnd = (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(fetchForCurrentView, DEBOUNCE_MS)
    }

    map.on('moveend', onMoveEnd)
    if (map.loaded()) fetchForCurrentView()
    else map.once('load', fetchForCurrentView)

    return () => {
      map.off('moveend', onMoveEnd)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [map])

  return viewpoints
}
