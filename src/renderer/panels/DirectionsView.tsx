import { useEffect, useMemo, useState } from 'react'
import { useViewFinderStore } from '../state/store'
import { CATEGORY_LABEL } from '../map/categoryStyle'
import { buildExternalMapsUrl } from '../utils/mapLinks'
import { useWakeLock } from '../hooks/useWakeLock'
import type { RouteStep } from '@shared/ipcContract'

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

// Local, not imported from RouteLayer.tsx - the renderer deliberately
// doesn't share a geo-math module with core/ (see state/store.ts's comment
// on MAX_ROAD_DISTANCE_SLIDER_METERS), and RouteLayer.tsx's own copy of
// this same function isn't exported, so this just follows that existing
// duplicate-it-locally convention rather than inventing a new shared file.
// Exported for DirectionsView.test.ts only.
export function haversineDistanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// Degrees to rotate the shared arrow glyph by, for every modifier OSRM
// sends - covers 'turn'/'end of road'/'fork'/'merge'/ramp/'continue' alike,
// since they're all "go this direction" and only differ in wording.
const MODIFIER_ROTATION: Record<string, number> = {
  uturn: 180,
  'sharp left': -135,
  left: -90,
  'slight left': -45,
  straight: 0,
  'slight right': 45,
  right: 90,
  'sharp right': 135
}

// One arrow SVG rotated per modifier, plus fixed glyphs for the cases
// rotation doesn't make sense for - covers every maneuver OSRM's demo
// server sends without a whole icon set.
function ManeuverIcon({ step, size = 22 }: { step: RouteStep; size?: number }): React.JSX.Element {
  // OSRM's 'depart' step carries a modifier too (the direction you're
  // initially facing), but describeStep() in osrmClient.ts already ignores
  // it for the instruction text ("Head out", never "Head out left") since
  // it isn't a turn to make - the icon shouldn't rotate on it either, or a
  // route starting out already facing left/right reads as its very first
  // instruction being a turn.
  if (step.type === 'depart') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="5" fill="currentColor" />
      </svg>
    )
  }

  if (step.type === 'arrive') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.15" />
        <path d="M12 6v7l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    )
  }

  if (step.type === 'roundabout' || step.type === 'rotary') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="2" />
        <path d="M12 5v4M12 5l-3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  const rotation = step.modifier ? (MODIFIER_ROTATION[step.modifier] ?? 0) : 0
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path
        d="M12 19V5M12 5l-6 6M12 5l6 6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Once the driver's GPS fix is within this of a maneuver's location, that
// maneuver counts as done and the next one becomes current - loose enough
// that ordinary GPS drift while driving doesn't stall on a turn already
// taken, tight enough not to skip a turn early on a straight approach.
export const MANEUVER_ARRIVAL_METERS = 25

// Pulled out of the component so the "never un-advance, catch up through
// several already-passed maneuvers if GPS was quiet for a while" logic can
// be tested directly against fixed coordinates instead of through a live
// GPS watch. `prev` never decreases; the last real step (index length-1,
// 'arrive') is deliberately never advanced onto since there's nothing after
// it to be "upcoming". Scans every candidate ahead of `prev` rather than
// just the immediate next one, so a GPS gap that skips straight past two
// close-together turns still lands on the furthest one actually reached,
// instead of getting stuck waiting to be near the first one it missed.
export function advancePassedStepIndex(
  prev: number,
  here: [number, number],
  steps: RouteStep[]
): number {
  let next = prev
  for (let i = prev + 1; i < steps.length - 1; i++) {
    if (haversineDistanceMeters(here, steps[i].location) < MANEUVER_ARRIVAL_METERS) {
      next = i
    }
  }
  return next
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
  const navigating = useViewFinderStore((s) => s.navigating)
  const startNavigation = useViewFinderStore((s) => s.startNavigation)

  useWakeLock(navigating)

  // Index of the last maneuver location the driver has already reached -
  // 0 means still on the initial ("depart") leg. Never decreases on its
  // own; only a fresh route (a new destination, or Start pressed again)
  // resets it, matching how real turn-by-turn never un-advances a turn.
  const [passedStepIndex, setPassedStepIndex] = useState(0)

  useEffect(() => {
    setPassedStepIndex(0)
  }, [route])

  useEffect(() => {
    if (!navigating || !route || !userLocation || route.steps.length < 2) return
    const here: [number, number] = [userLocation.lng, userLocation.lat]
    setPassedStepIndex((prev) => advancePassedStepIndex(prev, here, route.steps))
  }, [navigating, route, userLocation])

  const upcomingStep = route && route.steps.length > 1 ? route.steps[passedStepIndex + 1] : null
  const distanceToUpcoming = useMemo(() => {
    if (!upcomingStep || !userLocation) return null
    return haversineDistanceMeters([userLocation.lng, userLocation.lat], upcomingStep.location)
  }, [upcomingStep, userLocation])

  const estimatedMinutesRemaining = useMemo(() => {
    if (!route || passedStepIndex >= route.steps.length - 1) return null
    const remainingMeters = route.steps.slice(passedStepIndex + 1).reduce((sum, s) => sum + s.distanceMeters, 0)
    const avgSpeedKmh = 15
    const totalHours = remainingMeters / 1000 / avgSpeedKmh
    return Math.round(totalHours * 60)
  }, [route, passedStepIndex])

  const openInMaps = (): void => {
    if (!destination) return
    window.open(
      buildExternalMapsUrl({ lat: destination.lat, lng: destination.lng }, destination.name ?? undefined),
      '_blank',
      'noopener'
    )
  }

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

      {/* Independent of our own route status - only needs the destination,
          not a fetched OSRM route - so it's available immediately and
          doesn't depend on location tracking either. */}
      <button type="button" className="sidebar__open-in-maps" onClick={openInMaps}>
        Open in Maps
      </button>

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
            {formatRouteDistance(route.distanceMeters)} · {formatDuration(route.durationSeconds)} drive
            {/* The route ends at the nearest road, not necessarily right on
                top of the spot (see RouteLayer.tsx's dashed walk-in segment)
                - distanceToRoadMeters is the same figure already shown in
                the spot list, reused here so the two never disagree. */}
            {destination?.distanceToRoadMeters != null && destination.distanceToRoadMeters >= 15 && (
              <> · {formatRouteDistance(destination.distanceToRoadMeters)} walk</>
            )}
          </div>

          {!navigating && (
            <button type="button" className="sidebar__start-nav" onClick={startNavigation}>
              Start
            </button>
          )}

          {navigating && upcomingStep && (
            <div className="sidebar__turn-card">
              <span className="sidebar__turn-card-icon">
                <ManeuverIcon step={upcomingStep} size={32} />
              </span>
              <span className="sidebar__row-text">
                <span className="sidebar__turn-card-distance">
                  {distanceToUpcoming != null ? formatRouteDistance(distanceToUpcoming) : ''}
                  {estimatedMinutesRemaining != null && ` · ${estimatedMinutesRemaining} min`}
                </span>
                <span className="sidebar__row-name">{upcomingStep.instruction}</span>
              </span>
            </div>
          )}

          <div className="sidebar__rows">
            {route.steps.map((step, i) => (
              <div
                className={navigating && i <= passedStepIndex ? 'sidebar__step sidebar__step--done' : 'sidebar__step'}
                key={i}
              >
                <span className="sidebar__step-icon">
                  <ManeuverIcon step={step} />
                </span>
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
