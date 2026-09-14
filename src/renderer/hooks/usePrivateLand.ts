import { useEffect, useRef } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useViewFinderStore } from '../state/store'

// Same 500ms as useViewpoints.ts's DEBOUNCE_MS, for the same reason
// (coalesce rapid panning into one request rather than a burst).
const DEBOUNCE_MS = 500

// Only fetches/updates while the "show private land" toggle is on - this
// is an opt-in, occasional-use overlay, not part of the main pan-and-load
// loop, so there's no need to track it whenever the toggle is off.
export function usePrivateLandSync(map: MapLibreMap | null): void {
  const showPrivateLand = useViewFinderStore((s) => s.showPrivateLand)
  const setExcludedLandAreas = useViewFinderStore((s) => s.setExcludedLandAreas)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (!map || !showPrivateLand) return

    const fetchForCurrentView = (): void => {
      if (!window.viewFinderAPI?.getExcludedLand) return
      const bounds = map.getBounds()
      window.viewFinderAPI
        .getExcludedLand({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth()
        })
        .then(setExcludedLandAreas)
        .catch((error: unknown) => console.error('[usePrivateLand] getExcludedLand failed', error))
    }

    const onMoveEnd = (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(fetchForCurrentView, DEBOUNCE_MS)
    }

    fetchForCurrentView()
    map.on('moveend', onMoveEnd)

    return () => {
      map.off('moveend', onMoveEnd)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [map, showPrivateLand, setExcludedLandAreas])

  // Clear stale data once toggled off, so re-enabling it later doesn't
  // briefly flash outdated polygons from wherever the map was last time.
  useEffect(() => {
    if (!showPrivateLand) setExcludedLandAreas([])
  }, [showPrivateLand, setExcludedLandAreas])
}
