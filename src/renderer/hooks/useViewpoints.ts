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
  // Requests can resolve out of order (e.g. a slow retry/fallback for a
  // viewport the user has since panned away from finishing after a later,
  // faster request already succeeded). Only the response matching the most
  // recently *started* request is allowed to update the UI; anything else
  // is a stale result and gets dropped.
  const latestRequestIdRef = useRef(0)

  useEffect(() => {
    if (!map) return

    const fetchForCurrentView = (): void => {
      const requestId = ++latestRequestIdRef.current
      const isStale = (): boolean => latestRequestIdRef.current !== requestId

      // Wrapped in try/catch because a *synchronous* throw here (e.g. if
      // window.viewFinderAPI is somehow missing) would otherwise happen
      // outside the promise chain below - the .catch() wouldn't see it,
      // and setLoading() having already run would leave the UI stuck on
      // "Loading..." forever with no visible error at all.
      try {
        if (map.getZoom() < MIN_ZOOM_FOR_VIEWPOINTS) {
          setZoomedOut()
          return
        }

        setLoading()

        if (!window.viewFinderAPI?.getViewpoints) {
          throw new Error('viewFinderAPI is unavailable - the preload script did not load correctly')
        }

        const bounds = map.getBounds()
        console.log(`[useViewpoints] requesting (request #${requestId})`, bounds.toArray())
        window.viewFinderAPI
          .getViewpoints({
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth()
          })
          .then((result) => {
            if (isStale()) {
              console.log(`[useViewpoints] discarding stale response for request #${requestId}`)
              return
            }
            console.log('[useViewpoints] received', result.length, 'viewpoint(s)')
            setLoaded(result)
          })
          .catch((error: unknown) => {
            if (isStale()) {
              console.log(`[useViewpoints] discarding stale error for request #${requestId}`)
              return
            }
            console.error('[useViewpoints] IPC call rejected', error)
            setError(error instanceof Error ? error.message : 'Failed to load viewpoints')
          })
      } catch (error) {
        if (isStale()) return
        console.error('[useViewpoints] failed before IPC call was made', error)
        setError(error instanceof Error ? error.message : 'Failed to load viewpoints')
      }
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
