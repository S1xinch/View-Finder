import { useViewFinderStore } from '../state/store'
import { SpotRow } from './SpotRow'

// Spots starred on this device (see savedSpots in state/store.ts). Hidden
// while empty - the star on every spot row is the way in.
export function SavedLocations(): React.JSX.Element | null {
  const savedSpots = useViewFinderStore((s) => s.savedSpots)
  if (savedSpots.length === 0) return null

  return (
    <section className="saved-locations" aria-label="Saved spots">
      <div className="sidebar__count">Saved</div>
      <div className="sidebar__rows">
        {savedSpots.map((spot) => (
          <SpotRow key={spot.id} spot={spot} />
        ))}
      </div>
    </section>
  )
}
