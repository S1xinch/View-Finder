import { useEffect, useRef } from 'react'
import { useViewFinderStore } from '../state/store'

// Fetches driving directions whenever both a destination (requestRoute, set
// from a pin popup / sidebar row) and the user's live location are
// available. Call this once near the top of the tree, same as
// useViewpointsSync - anything that needs the route reads it from the
// store.
export function useRoute(): void {
  const routeDestination = useViewFinderStore((s) => s.routeDestination)
  const routeRequestNonce = useViewFinderStore((s) => s.routeRequestNonce)
  const userLocation = useViewFinderStore((s) => s.userLocation)
  const setRouteLoading = useViewFinderStore((s) => s.setRouteLoading)
  const setRouteLoaded = useViewFinderStore((s) => s.setRouteLoaded)
  const setRouteError = useViewFinderStore((s) => s.setRouteError)

  // Requests can resolve out of order (a slow request for a since-abandoned
  // destination finishing after a newer one already succeeded) - only the
  // most recently *started* request is allowed to update the UI.
  const latestRequestIdRef = useRef(0)

  useEffect(() => {
    if (!routeDestination) return

    if (!userLocation) {
      // requestRoute() already turns location tracking on, so this is
      // ordinarily just "waiting for the first GPS fix to arrive", not a
      // real failure - setRouteLoading() keeps the UI in a loading state
      // rather than flashing an error the user didn't cause.
      setRouteLoading()
      return
    }

    const requestId = ++latestRequestIdRef.current
    const isStale = (): boolean => latestRequestIdRef.current !== requestId

    try {
      setRouteLoading()

      if (!window.viewFinderAPI?.getRoute) {
        throw new Error('viewFinderAPI is unavailable - the preload script did not load correctly')
      }

      window.viewFinderAPI
        .getRoute(
          { lat: userLocation.lat, lng: userLocation.lng },
          { lat: routeDestination.lat, lng: routeDestination.lng }
        )
        .then((result) => {
          if (isStale()) return
          setRouteLoaded(result)
        })
        .catch((error: unknown) => {
          if (isStale()) return
          console.error('[useRoute] IPC call rejected', error)
          setRouteError(error instanceof Error ? error.message : 'Failed to load directions')
        })
    } catch (error) {
      if (isStale()) return
      console.error('[useRoute] failed before IPC call was made', error)
      setRouteError(error instanceof Error ? error.message : 'Failed to load directions')
    }
    // Deliberately NOT re-running on every userLocation update (a live GPS
    // watch fires often) - only on a new request (routeRequestNonce, which
    // also covers asking for the same spot again), or when location first
    // becomes available after being missing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeDestination, routeRequestNonce, Boolean(userLocation)])
}
