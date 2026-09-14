import { useViewFinderStore } from '../state/store'
import { CATEGORY_LABEL } from '../map/categoryStyle'

function formatRouteDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`
}

// Replaces the sidebar's normal filter/spot-list body while a route is
// active (see useRoute.ts, requestRoute in state/store.ts). Rendered only
// when routeDestination is set - Sidebar.tsx gates that.
export function DirectionsView(): React.JSX.Element {
  const destination = useViewFinderStore((s) => s.routeDestination)
  const status = useViewFinderStore((s) => s.routeStatus)
  const route = useViewFinderStore((s) => s.route)
  const error = useViewFinderStore((s) => s.routeError)
  const clearRoute = useViewFinderStore((s) => s.clearRoute)
  const userLocation = useViewFinderStore((s) => s.userLocation)
  const locationError = useViewFinderStore((s) => s.locationError)

  return (
    <div className="sidebar__directions">
      <div className="sidebar__directions-header">
        <button type="button" className="sidebar__back" onClick={clearRoute} aria-label="Back to spot list">
          ‹
        </button>
        <div className="sidebar__row-text">
          <span className="sidebar__row-name">
            {destination ? (destination.name ?? CATEGORY_LABEL[destination.category]) : ''}
          </span>
          <span className="sidebar__row-detail">Driving directions</span>
        </div>
      </div>

      {status === 'loading' && !userLocation && locationError && (
        <div className="sidebar__status sidebar__status--error">{locationError}</div>
      )}

      {status === 'loading' && (userLocation || !locationError) && (
        <div className="sidebar__status">{userLocation ? 'Finding a route…' : 'Getting your location…'}</div>
      )}

      {status === 'error' && <div className="sidebar__status sidebar__status--error">{error}</div>}

      {status === 'ready' && route && (
        <>
          <div className="sidebar__directions-summary">
            {formatRouteDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)}
          </div>
          <div className="sidebar__rows">
            {route.steps.map((step, i) => (
              <div className="sidebar__step" key={i}>
                <span className="sidebar__step-index">{i + 1}</span>
                <span className="sidebar__row-text">
                  <span className="sidebar__row-name">{step.instruction}</span>
                  {step.distanceMeters > 0 && (
                    <span className="sidebar__row-detail">{formatRouteDistance(step.distanceMeters)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
