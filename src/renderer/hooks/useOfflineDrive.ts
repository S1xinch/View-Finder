import { useEffect } from 'react'
import { selectActiveRoute, useViewFinderStore } from '../state/store'
import { DRIVE_CACHE, offlineSupport, saveTilesOffline, tilesAlongRoute } from '../utils/offlineArea'

// Website only: quietly saves the map along the current drive so it keeps
// working without reception, and deletes it once the drive ends (directions
// closed, or a new destination). The route itself is kept by store.ts.
export function useOfflineDrive(): void {
  const map = useViewFinderStore((s) => s.map)
  const route = useViewFinderStore(selectActiveRoute)

  useEffect(() => {
    if (!offlineSupport.enabled) return
    if (!route) {
      void caches.delete(DRIVE_CACHE)
      return
    }
    if (!map || !navigator.onLine) return
    // ponytail: a superseded download keeps running to the end; tiles it
    // writes after the drive is cleared linger until the next drive ends.
    saveTilesOffline(map, tilesAlongRoute(route.coordinates), () => undefined, DRIVE_CACHE).catch((error: unknown) =>
      console.warn('[useOfflineDrive] saving the drive failed', error)
    )
  }, [map, route])
}
