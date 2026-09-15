import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewFinderStore } from '../state/store'
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../map/categoryStyle'
import { Logo } from '../Logo'
import { DirectionsView } from './DirectionsView'
import { SearchBar } from './SearchBar'
import type { Viewpoint } from '@shared/ipcContract'

// Most fetches (especially cache hits, common while re-panning over
// recently-viewed areas) resolve faster than this - showing a loading
// message for those just adds visual noise/flicker rather than useful
// feedback. Only reveal it if a fetch is still running after a brief delay.
const LOADING_REVEAL_DELAY_MS = 250

function passesFilters(vp: Viewpoint, minElevationMeters: number, maxDistanceToRoadMeters: number): boolean {
  if ((vp.elevationMeters ?? 0) < minElevationMeters) return false
  const distance = vp.distanceToRoadMeters
  // Unknown distance (no road data) is never excluded here - matches the
  // permissive treatment already applied server-side in
  // roadReachability.ts, for the same reason: missing data isn't evidence
  // of unreachability.
  if (distance != null && distance > maxDistanceToRoadMeters) return false
  return true
}

function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return 'distance to road unknown'
  if (meters < 30) return 'right on a road'
  return `${Math.round(meters)} m from road`
}

// A real swipe on a touch device (drag past the threshold, then lift) and
// a plain tap both need to toggle the sheet - but a tap also fires a
// native click right after pointerup, so without the handledRef guard a
// swipe would toggle it twice (once here, once from that click).
const SWIPE_THRESHOLD_PX = 20

function useSwipeToggle(onToggle: () => void): {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onClick: () => void
} {
  const startYRef = useRef<number | null>(null)
  const handledRef = useRef(false)

  return {
    onPointerDown: (e) => {
      startYRef.current = e.clientY
      handledRef.current = false
    },
    onPointerUp: (e) => {
      const startY = startYRef.current
      startYRef.current = null
      if (startY == null) return
      if (Math.abs(e.clientY - startY) >= SWIPE_THRESHOLD_PX) {
        handledRef.current = true
        onToggle()
      }
    },
    onClick: () => {
      if (handledRef.current) {
        handledRef.current = false
        return
      }
      onToggle()
    }
  }
}

// Shared by the "Search this area" button (spins while a fetch is running)
// and reused as-is for the "Try again" affordance on error - one glyph for
// every manual-refresh action in the sidebar.
function RefreshIcon({ spinning }: { spinning: boolean }): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={spinning ? 'sidebar__refresh-icon sidebar__refresh-icon--spinning' : 'sidebar__refresh-icon'}
    >
      <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Maps the raw error text (network error codes, HTTP statuses, etc.) to a
// plain-language explanation. The exact original message is kept as the
// element's `title` (a hover tooltip) so it's not lost for troubleshooting.
function friendlyMessage(error: string): string {
  if (/ERR_CONNECTION|ConnectTimeout|ETIMEDOUT|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(error)) {
    return "Couldn't reach OpenStreetMap's servers — check your internet connection and try again."
  }
  if (/\b429\b/.test(error)) {
    return "OpenStreetMap's free server is asking us to slow down — try again in a moment."
  }
  if (/\b50[234]\b/.test(error)) {
    return "OpenStreetMap's free server is temporarily unavailable — try again in a moment."
  }
  return "Couldn't load viewpoints — try again in a moment."
}

// Single unified left panel - the app's one persistent floating card,
// replacing what used to be a separate brand card, spot list, and status
// toast scattered around the screen.
export function Sidebar(): React.JSX.Element {
  const map = useViewFinderStore((s) => s.map)
  const viewpoints = useViewFinderStore((s) => s.viewpoints)
  const status = useViewFinderStore((s) => s.viewpointsStatus)
  const error = useViewFinderStore((s) => s.viewpointsError)
  const filters = useViewFinderStore((s) => s.filters)
  const setMinElevationMeters = useViewFinderStore((s) => s.setMinElevationMeters)
  const setMaxDistanceToRoadMeters = useViewFinderStore((s) => s.setMaxDistanceToRoadMeters)
  const sidebarOpen = useViewFinderStore((s) => s.sidebarOpen)
  const toggleSidebar = useViewFinderStore((s) => s.toggleSidebar)
  const showPrivateLand = useViewFinderStore((s) => s.showPrivateLand)
  const togglePrivateLand = useViewFinderStore((s) => s.togglePrivateLand)
  const routeDestination = useViewFinderStore((s) => s.routeDestination)
  const requestRoute = useViewFinderStore((s) => s.requestRoute)
  const requestViewpointsRefresh = useViewFinderStore((s) => s.requestViewpointsRefresh)

  // Shared by the collapsed pull-tab and the open sheet's own grabber row -
  // only one of the two is ever rendered at a time, so one toggle handler
  // covers both.
  const swipeHandlers = useSwipeToggle(toggleSidebar)

  const [showLoading, setShowLoading] = useState(false)

  useEffect(() => {
    if (status !== 'loading') {
      setShowLoading(false)
      return
    }
    const timer = setTimeout(() => setShowLoading(true), LOADING_REVEAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [status])

  const filtered = useMemo(
    () => viewpoints.filter((vp) => passesFilters(vp, filters.minElevationMeters, filters.maxDistanceToRoadMeters)),
    [viewpoints, filters]
  )

  const flyTo = (vp: Viewpoint): void => {
    map?.flyTo({ center: [vp.lng, vp.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 })
  }

  if (!sidebarOpen) {
    return (
      <button
        type="button"
        className={`sidebar-reopen vf-card${status === 'loading' ? ' sidebar-reopen--loading' : ''}`}
        {...swipeHandlers}
        aria-label={status === 'loading' ? 'Show sidebar (loading viewpoints)' : 'Show sidebar'}
      >
        {/* Desktop's small round button keeps its plain arrow glyph;
            mobile hides this and shows the pull-tab's handle+caption
            below instead (see the display swap in global.css). */}
        <span className="sidebar-reopen__arrow" aria-hidden="true">
          ›
        </span>
        <span className="sidebar__handle" aria-hidden="true" />
        <span className="sidebar-reopen__label" aria-hidden="true">
          {status === 'ready'
            ? `${filtered.length} cool spot${filtered.length === 1 ? '' : 's'}`
            : status === 'loading'
              ? 'Searching…'
              : 'View Finder'}
        </span>
      </button>
    )
  }

  return (
    <aside className="vf-card sidebar">
      {/* Mobile-only (see global.css) swipe-down-to-close target, matching
          how a native bottom sheet's own drag handle behaves - the
          explicit collapse button in the header below still covers
          desktop/non-touch use. */}
      <div
        className="sidebar__grabber"
        role="button"
        tabIndex={0}
        aria-label="Hide sidebar"
        {...swipeHandlers}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggleSidebar()
        }}
      >
        <span className="sidebar__handle" aria-hidden="true" />
      </div>

      <header className="sidebar__header">
        <Logo />
        <div className="sidebar__title-group">
          <h1 className="sidebar__title">View Finder</h1>
          <span className="sidebar__subtitle">Scenic high ground, reachable by car</span>
        </div>
        <button type="button" className="sidebar__collapse" onClick={toggleSidebar} aria-label="Hide sidebar">
          ‹
        </button>
      </header>

      <SearchBar />

      {routeDestination ? (
        <div className="sidebar__body">
          <DirectionsView />
        </div>
      ) : (
        <>
          <div className="sidebar__filters">
            <label className="sidebar__filter">
              <span>Min elevation: {filters.minElevationMeters} m</span>
              <input
                type="range"
                min={0}
                max={4000}
                step={50}
                value={filters.minElevationMeters}
                onChange={(e) => setMinElevationMeters(Number(e.target.value))}
              />
            </label>
            <label className="sidebar__filter">
              <span>Max distance to road: {filters.maxDistanceToRoadMeters} m</span>
              <input
                type="range"
                min={0}
                max={500}
                step={25}
                value={filters.maxDistanceToRoadMeters}
                onChange={(e) => setMaxDistanceToRoadMeters(Number(e.target.value))}
              />
            </label>
            <label className="sidebar__checkbox">
              <input type="checkbox" checked={showPrivateLand} onChange={togglePrivateLand} />
              <span>Show private/farmland</span>
            </label>

            {/* Auto-search waits for panning to genuinely stop before
                firing (see DEBOUNCE_MS in useViewpoints.ts) - this lets
                the search happen immediately on demand instead, without
                waiting or needing to nudge the map. */}
            <button
              type="button"
              className="sidebar__search-button"
              onClick={requestViewpointsRefresh}
              disabled={status === 'loading'}
            >
              <RefreshIcon spinning={status === 'loading'} />
              Search this area
            </button>
          </div>

          <div className="sidebar__body">
            {status === 'zoomed-out' && <div className="sidebar__status">Zoom in to see viewpoints and peaks</div>}

            {status === 'idle' && <div className="sidebar__status">Pan the map to find scenic spots</div>}

            {status === 'loading' && showLoading && (
              <div className="sidebar__status sidebar__status--loading">
                Loading viewpoints…
                <div className="sidebar__status-progress" />
              </div>
            )}

            {status === 'error' && (
              <div className="sidebar__status sidebar__status--error" title={error ?? undefined}>
                {friendlyMessage(error ?? '')}
                <button type="button" className="sidebar__retry" onClick={requestViewpointsRefresh}>
                  Try again
                </button>
              </div>
            )}

            {status === 'ready' && (
              <>
                <div className="sidebar__count">
                  {filtered.length} cool spot{filtered.length === 1 ? '' : 's'}
                </div>
                <div className="sidebar__rows">
                  {filtered.length === 0 && <div className="sidebar__empty">No spots match these filters</div>}
                  {filtered.map((vp) => (
                    <div className="sidebar__row" key={vp.id}>
                      <button type="button" className="sidebar__row-main" onClick={() => flyTo(vp)}>
                        <span className="sidebar__dot" style={{ backgroundColor: CATEGORY_COLOR[vp.category] }} />
                        <span className="sidebar__row-text">
                          <span className="sidebar__row-name">{vp.name ?? CATEGORY_LABEL[vp.category]}</span>
                          <span className="sidebar__row-detail">
                            {vp.elevationMeters != null ? `${Math.round(vp.elevationMeters)} m` : 'elevation unknown'}{' '}
                            · {formatDistance(vp.distanceToRoadMeters)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="sidebar__row-directions"
                        onClick={() => requestRoute(vp)}
                        aria-label={`Directions to ${vp.name ?? CATEGORY_LABEL[vp.category]}`}
                        title="Directions"
                      >
                        →
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      <footer className="sidebar__footer">
        <a href="https://github.com/S1xinch/View-Finder" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/S1xinch/View-Finder/releases/latest" target="_blank" rel="noopener noreferrer">
          Download desktop app
        </a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/S1xinch/View-Finder#troubleshooting" target="_blank" rel="noopener noreferrer">
          Troubleshooting
        </a>
      </footer>
    </aside>
  )
}
