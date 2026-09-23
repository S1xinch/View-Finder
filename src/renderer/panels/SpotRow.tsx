import { useViewFinderStore } from '../state/store'
import { CATEGORY_LABEL } from '../map/categoryStyle'
import { visibleCenterOffset } from '../map/mapInsets'
import { CATEGORY_COLORS } from '../themes'
import type { Viewpoint } from '@shared/ipcContract'

function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return 'distance to road unknown'
  if (meters < 30) return 'right on a road'
  return `${Math.round(meters)} m from road`
}

// One spot in a list (search results or Saved): tap to fly there, star to
// save/unsave on this device, arrow for directions.
export function SpotRow({ spot }: { spot: Viewpoint }): React.JSX.Element {
  const map = useViewFinderStore((s) => s.map)
  const theme = useViewFinderStore((s) => s.theme)
  const requestRoute = useViewFinderStore((s) => s.requestRoute)
  const saved = useViewFinderStore((s) => s.savedSpots.some((v) => v.id === spot.id))
  const toggleSavedSpot = useViewFinderStore((s) => s.toggleSavedSpot)
  const label = spot.name ?? CATEGORY_LABEL[spot.category]

  const flyTo = (): void => {
    if (!map) return
    map.flyTo({
      center: [spot.lng, spot.lat],
      zoom: Math.max(map.getZoom(), 14),
      offset: visibleCenterOffset(map),
      duration: 800
    })
  }

  return (
    <div className="sidebar__row">
      <button type="button" className="sidebar__row-main" onClick={flyTo}>
        <span
          className="sidebar__badge"
          data-category={spot.category}
          style={{ backgroundColor: CATEGORY_COLORS[theme][spot.category] }}
          aria-hidden="true"
        />
        <span className="sidebar__row-text">
          <span className="sidebar__row-name">{label}</span>
          <span className="sidebar__row-detail">
            {spot.elevationMeters != null ? `${Math.round(spot.elevationMeters)} m` : 'elevation unknown'} ·{' '}
            {formatDistance(spot.distanceToRoadMeters)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className={saved ? 'sidebar__row-save sidebar__row-save--saved' : 'sidebar__row-save'}
        onClick={() => toggleSavedSpot(spot)}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${label} from saved` : `Save ${label}`}
        title={saved ? 'Saved' : 'Save'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"
            fill={saved ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className="sidebar__row-directions"
        onClick={() => requestRoute(spot)}
        aria-label={`Directions to ${label}`}
        title="Directions"
      >
        →
      </button>
    </div>
  )
}
