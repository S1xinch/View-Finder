import { useCallback, useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'

// Wait for panning/zooming to *genuinely* settle before fetching - not just
// a brief pause between two movements. A full second of stillness is long
// enough that a quick flick-and-recatch of the map (common on trackpads/
// touch) never starts a search at all, only actually stopping does. Also
// keeps the free public Overpass instances from seeing a burst of
// *separate* viewport requests fired in quick succession while panning
// around.
const DEBOUNCE_MS = 1000

// Most failures at this point are transient (a momentary network hiccup, a
// single endpoint briefly rate-limited) - giving it one automatic retry
// before bothering the user with an error state resolves most of them
// without any visible interruption. Long enough to not just repeat into
// the same rate limit immediately.
const RETRY_DELAY_MS = 2500

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
  // Bumped by the Sidebar's "Search this area"/"Try again" buttons - see
  // the comment on this field in state/store.ts for why it's a nonce
  // rather than the fetch function being exposed directly.
  const refreshNonce = useViewFinderStore((s) => s.viewpointsRefreshNonce)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  // Requests can resolve out of order (e.g. a slow retry/fallback for a
  // viewport the user has since panned away from finishing after a later,
  // faster request already succeeded). Only the response matching the most
  // recently *started* request is allowed to update the UI; anything else
  // is a stale result and gets dropped.
  const latestRequestIdRef = useRef(0)
  // The effect below re-subscribes map event listeners whenever `map`
  // changes, but fetchForCurrentView itself doesn't need to be recreated
  // for that - it reads the current map from a ref instead, so its own
  // identity (and the manual-refresh effect that depends on it) stays
  // stable across those re-subscriptions.
  const mapRef = useRef<MapLibreMap | null>(map)
  mapRef.current = map

  const fetchForCurrentView = useCallback(
    (isRetry: boolean): void => {
      const currentMap = mapRef.current
      if (!currentMap) return

      const requestId = ++latestRequestIdRef.current
      const isStale = (): boolean => latestRequestIdRef.current !== requestId

      // Wrapped in try/catch because a *synchronous* throw here (e.g. if
      // window.viewFinderAPI is somehow missing) would otherwise happen
      // outside the promise chain below - the .catch() wouldn't see it,
      // and setLoading() having already run would leave the UI stuck on
      // "Loading..." forever with no visible error at all.
      try {
        if (currentMap.getZoom() < MIN_ZOOM_FOR_VIEWPOINTS) {
          setZoomedOut()
          return
        }

        setLoading()

        if (!window.viewFinderAPI?.getViewpoints) {
          throw new Error('viewFinderAPI is unavailable - the preload script did not load correctly')
        }

        const bounds = currentMap.getBounds()
        console.log(`[useViewpoints] requesting (request #${requestId}${isRetry ? ', retry' : ''})`, bounds.toArray())
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
            if (!isRetry) {
              console.warn('[useViewpoints] request failed, retrying once', error)
              retryTimeoutRef.current = setTimeout(() => {
                if (isStale()) return
                fetchForCurrentView(true)
              }, RETRY_DELAY_MS)
              return
            }
            console.error('[useViewpoints] IPC call rejected (after retry)', error)
            setError(error instanceof Error ? error.message : 'Failed to load viewpoints')
          })
      } catch (error) {
        if (isStale()) return
        if (!isRetry) {
          retryTimeoutRef.current = setTimeout(() => {
            if (isStale()) return
            fetchForCurrentView(true)
          }, RETRY_DELAY_MS)
          return
        }
        console.error('[useViewpoints] failed before IPC call was made', error)
        setError(error instanceof Error ? error.message : 'Failed to load viewpoints')
      }
    },
    [setLoading, setZoomedOut, setLoaded, setError]
  )

  useEffect(() => {
    if (!map) return

    const onMoveEnd = (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      debounceRef.current = setTimeout(() => fetchForCurrentView(false), DEBOUNCE_MS)
    }

    map.on('moveend', onMoveEnd)
    if (map.loaded()) fetchForCurrentView(false)
    else map.once('load', () => fetchForCurrentView(false))

    return () => {
      map.off('moveend', onMoveEnd)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
    }
  }, [map, fetchForCurrentView])

  // Skips the very first run (the effect above already covers the initial
  // load) - this one exists purely to react to later bumps of the nonce
  // from the manual "Search this area"/"Try again" buttons.
  const isFirstRefreshRun = useRef(true)
  useEffect(() => {
    if (isFirstRefreshRun.current) {
      isFirstRefreshRun.current = false
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
    fetchForCurrentView(false)
  }, [refreshNonce, fetchForCurrentView])
}
