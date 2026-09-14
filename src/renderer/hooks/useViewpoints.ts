import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'

// Wait for panning/zooming to settle before fetching, so rapid movement
// doesn't fire a burst of IPC calls that each fan out to Overpass.
const DEBOUNCE_MS = 500

// Below this zoom the viewport covers a huge area (a whole country/continent
// at zoom ~4-5) — querying that would mean hundreds of Overpass tile
// requests. Instead we just wait for the user to zoom in further, which is
// also better UX (a screen full of markers at continent scale isn't useful).
export const MIN_ZOOM_FOR_VIEWPOINTS = 8

// Performs the viewport -> Overpass fetch side effect and writes results
// into the shared store. Call this once near the top of the tree; anything
// that needs the data or its loading/error state reads it from the store.
export function useViewpointsSync(map: MapLibreMap | null): void {
  const setLoading = useViewFinderStore((s) => s.setViewpointsLoading)
  const setZoomedOut = useViewFinderStore((s) => s.setViewpointsZoomedOut)
  const setLoaded = useViewFinderStore((s) => s.setViewpointsLoaded)
  const setError = useViewFinderStore((s) => s.setViewpointsError)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!map) return

    const fetchForCurrentView = (): void => {
      if (map.getZoom() < MIN_ZOOM_FOR_VIEWPOINTS) {
        setZoomedOut()
        return
      }

      setLoading()
      const bounds = map.getBounds()
      window.viewFinderAPI
        .getViewpoints({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth()
        })
        .then(setLoaded)
        .catch((error: unknown) => {
          console.error('Failed to load viewpoints', error)
          setError(error instanceof Error ? error.message : 'Failed to load viewpoints')
        })
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
  }, [map, setLoading, setZoomedOut, setLoaded, setError])
}
