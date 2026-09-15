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

function passesFilters(
  vp: Viewpoint,
  minElevationMeters: number,
  maxDistanceToRoadMeters: number,
  showOsmViewpoints: boolean,
  showComputedPeaks: boolean
): boolean {
  const isComputed = vp.category === 'computed_peak'
  if (isComputed && !showComputedPeaks) return false
  if (!isComputed && !showOsmViewpoints) return false
  if ((vp.elevationMeters ?? 0) < minElevationMeters) return false
  const distance = vp.distanceToRoadMeters
  // Unknown distance (no road data) is never excluded here - matches the
  // permissive treatment already applied server-side in
  // roadReachability.ts, for the same reason: missing data isn't evidence
  // of unreachability.
  if (distance != null && distance > maxDistanceToRoadMeters) return false
  return true
}

// Threshold for the "zoom in for a clearer view" hint - past this many
// pins on screen at once, individual markers start overlapping/clustering
// visually rather than being individually useful.
const MANY_RESULTS_THRESHOLD = 40

// Tile count above which a failed search was covering enough ground that
// "try a smaller area" is genuinely good advice, not just noise - matches
// what a typical viewport already produces well before MIN_ZOOM_FOR_VIEWPOINTS
// (see useViewpoints.ts), so this only fires for real "too much at once" cases.
const MANY_TILES_THRESHOLD = 4

function formatDistance(meters: number | null | undefined): string {
  if (meters == null) return 'distance to road unknown'
  if (meters < 30) return 'right on a road'
  return `${Math.round(meters)} m from road`
}

// Below this drag distance, a release is read as "changed my mind" (or a
// plain tap) rather than a real swipe - the dragged element rubber-bands
// back to its resting position instead of toggling. Past it, the gesture
// commits and the sheet opens/closes.
const DRAG_COMMIT_PX = 40

// Real finger-follow dragging (not just a tap-to-toggle): the target
// element (the collapsed pull-tab, or the open sheet - see targetRef)
// is translated 1:1 with the pointer in real time via direct DOM style
// mutation, not React state - a state update (and re-render) per
// pointermove would be both unnecessary work and a frame behind the
// finger. CSS owns the resting-position transition (see .sidebar-reopen/
// .sidebar in global.css); this only disables it during the drag itself
// (transition: none) so the element tracks 1:1 with no lag, then restores
// it on release so the rubber-band/final-snap animates instead of
// jumping.
//
// The pull-tab can only drag upward (toward opening) and the open sheet's
// grabber only downward (toward closing) - the opposite direction is
// clamped to 0 so the gesture never fights itself by dragging a corner
// that's already at its resting edge.
//
// setPointerCapture guarantees pointerup still fires on this element even
// if the finger drifted off it mid-gesture. onClick stays only as the
// fallback for a *keyboard* activation (Enter/Space fires a synthetic
// click with no pointerdown ever having happened) - pointerHandledRef
// suppresses it for a real touch/mouse gesture so that doesn't
// double-toggle.
function useDraggableSheet(
  targetRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  onToggle: () => void
): {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onClick: () => void
} {
  const pointerHandledRef = useRef(false)
  const dragStartYRef = useRef<number | null>(null)
  const dragStartTimeRef = useRef(0)

  const setTransform = (px: number): void => {
    const el = targetRef.current
    if (el) el.style.transform = px === 0 ? '' : `translateY(${px}px)`
  }

  return {
    onPointerDown: (e) => {
      // Real pointer sessions always accept capture; a synthetic
      // PointerEvent with a made-up id (e.g. in a test) throws here -
      // swallowed so it can't silently skip setting dragStartYRef below
      // and break every subsequent gesture on this element.
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* not a real pointer session - ignore */
      }
      dragStartYRef.current = e.clientY
      dragStartTimeRef.current = e.timeStamp
      const el = targetRef.current
      if (el) el.style.transition = 'none'
    },
    onPointerMove: (e) => {
      if (dragStartYRef.current == null) return
      const delta = e.clientY - dragStartYRef.current
      setTransform(open ? Math.max(0, delta) : Math.min(0, delta))
    },
    onPointerUp: (e) => {
      e.currentTarget.releasePointerCapture(e.pointerId)
      pointerHandledRef.current = true
      const startY = dragStartYRef.current
      const startTime = dragStartTimeRef.current
      dragStartYRef.current = null
      const el = targetRef.current
      if (el) el.style.transition = ''
      setTransform(0)
      if (startY == null) return
      const delta = e.clientY - startY
      // A plain tap (near-zero movement - real fingers/mice never land
      // pointerup at the *exact* pointerdown pixel) always toggles, same
      // as a click - only a real, deliberate drag needs to clear
      // DRAG_COMMIT_PX in the right direction. Without this, tapping the
      // pull-tab/grabber stopped doing anything: a tap's ~0px delta
      // satisfied neither commit condition below, so it fell through to
      // the rubber-band-back branch instead of opening/closing.
      const TAP_THRESHOLD_PX = 8
      // A quick flick commits well short of DRAG_COMMIT_PX - real bottom
      // sheets go by velocity, not just distance travelled, since a fast
      // short flick clearly signals intent the same way a slow long drag
      // does. Without this, only a slow, deliberate drag past the full
      // threshold worked; an actual quick swipe (the natural gesture, and
      // the whole point of a "swipe to open" sheet) did nothing at all.
      const elapsedMs = Math.max(1, e.timeStamp - startTime)
      const velocity = Math.abs(delta) / elapsedMs
      const FLICK_MIN_DISTANCE_PX = 12
      const FLICK_VELOCITY_PX_PER_MS = 0.5
      const isFlick = Math.abs(delta) >= FLICK_MIN_DISTANCE_PX && velocity >= FLICK_VELOCITY_PX_PER_MS
      if (Math.abs(delta) < TAP_THRESHOLD_PX) onToggle()
      else if (open && (delta > DRAG_COMMIT_PX || (delta > 0 && isFlick))) onToggle()
      else if (!open && (delta < -DRAG_COMMIT_PX || (delta < 0 && isFlick))) onToggle()
    },
    onClick: () => {
      if (pointerHandledRef.current) {
        pointerHandledRef.current = false
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
// tilesTotal (the failed request's own tile count, if known - see the
// store's setViewpointsError comment for why progress survives into the
// error state) lets a timeout specifically suggest zooming in: a request
// covering many tiles is both more likely to time out and has an easy fix
// the generic "try again" advice doesn't mention.
function friendlyMessage(error: string, tilesTotal: number | null): string {
  const searchedManyTiles = tilesTotal != null && tilesTotal >= MANY_TILES_THRESHOLD
  if (/timeout|timed out/i.test(error)) {
    return searchedManyTiles
      ? "That search covered a lot of ground and timed out — try zooming in to search a smaller area."
      : "The search timed out — try again in a moment."
  }
  if (/ERR_CONNECTION|ConnectTimeout|ETIMEDOUT|ENOTFOUND|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(error)) {
    return "Couldn't reach OpenStreetMap's servers — check your internet connection and try again."
  }
  if (/\b429\b/.test(error)) {
    return "OpenStreetMap's free server is asking us to slow down — try again in a moment."
  }
  if (/\b50[234]\b/.test(error)) {
    return "OpenStreetMap's free server is temporarily unavailable — try again in a moment."
  }
  return searchedManyTiles
    ? "Couldn't load viewpoints — try zooming in to search a smaller area, or try again in a moment."
    : "Couldn't load viewpoints — try again in a moment."
}

// Single unified left panel - the app's one persistent floating card,
// replacing what used to be a separate brand card, spot list, and status
// toast scattered around the screen.
export function Sidebar(): React.JSX.Element {
  const map = useViewFinderStore((s) => s.map)
  const viewpoints = useViewFinderStore((s) => s.viewpoints)
  const status = useViewFinderStore((s) => s.viewpointsStatus)
  const error = useViewFinderStore((s) => s.viewpointsError)
  const progress = useViewFinderStore((s) => s.viewpointsProgress)
  const filters = useViewFinderStore((s) => s.filters)
  const setMinElevationMeters = useViewFinderStore((s) => s.setMinElevationMeters)
  const setMaxDistanceToRoadMeters = useViewFinderStore((s) => s.setMaxDistanceToRoadMeters)
  const sidebarOpen = useViewFinderStore((s) => s.sidebarOpen)
  const toggleSidebar = useViewFinderStore((s) => s.toggleSidebar)
  const showPrivateLand = useViewFinderStore((s) => s.showPrivateLand)
  const togglePrivateLand = useViewFinderStore((s) => s.togglePrivateLand)
  const showOsmViewpoints = useViewFinderStore((s) => s.showOsmViewpoints)
  const toggleShowOsmViewpoints = useViewFinderStore((s) => s.toggleShowOsmViewpoints)
  const showComputedPeaks = useViewFinderStore((s) => s.showComputedPeaks)
  const toggleShowComputedPeaks = useViewFinderStore((s) => s.toggleShowComputedPeaks)
  const routeDestination = useViewFinderStore((s) => s.routeDestination)
  const requestRoute = useViewFinderStore((s) => s.requestRoute)
  const requestViewpointsRefresh = useViewFinderStore((s) => s.requestViewpointsRefresh)

  // Both the collapsed pull-tab and the open sheet are ALWAYS mounted now
  // (see the render below) rather than one replacing the other - the
  // instant React-tree swap was exactly why opening/closing "popped"
  // instead of rolling out: there was no continuous element to actually
  // animate across the transition, just an unmount of one and a mount of
  // the other. With both always present, CSS (see .sidebar--hidden/
  // .sidebar-reopen--hidden in global.css) can transform whichever one is
  // supposed to be off-screen, and useDraggableSheet's drag-follow uses
  // the same mechanism it always did - it just now targets two distinct,
  // permanently-mounted elements instead of alternating.
  const reopenRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLElement>(null)
  const reopenDragHandlers = useDraggableSheet(reopenRef, sidebarOpen, toggleSidebar)
  const sheetDragHandlers = useDraggableSheet(sheetRef, sidebarOpen, toggleSidebar)

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
    () =>
      viewpoints.filter((vp) =>
        passesFilters(vp, filters.minElevationMeters, filters.maxDistanceToRoadMeters, showOsmViewpoints, showComputedPeaks)
      ),
    [viewpoints, filters, showOsmViewpoints, showComputedPeaks]
  )

  // Raw (pre-filter) counts by category, for the empty/ready-state
  // breakdowns below - lets a message say *which* category came up short
  // instead of just "nothing found", including revealing when computed
  // peaks are 0 because they were never searched (see coolSpotOrchestrator's
  // lazy-elevation skip) rather than because none exist.
  const osmCount = useMemo(() => viewpoints.filter((vp) => vp.category !== 'computed_peak').length, [viewpoints])
  const computedCount = viewpoints.length - osmCount

  const flyTo = (vp: Viewpoint): void => {
    map?.flyTo({ center: [vp.lng, vp.lat], zoom: Math.max(map.getZoom(), 14), duration: 800 })
  }

  const reopenButton = (
      <button
        ref={reopenRef}
        type="button"
        className={`sidebar-reopen vf-card${status === 'loading' ? ' sidebar-reopen--loading' : ''}${sidebarOpen ? ' sidebar-reopen--hidden' : ''}`}
        {...reopenDragHandlers}
        aria-label={status === 'loading' ? 'Show sidebar (loading viewpoints)' : 'Show sidebar'}
      >
        {/* Desktop's small round button keeps its plain arrow glyph;
            mobile hides this and shows the pull-tab's handle+caption
            below instead (see the display swap in global.css). */}
        <span className="sidebar-reopen__arrow" aria-hidden="true">
          ›
        </span>
        <span className="sidebar__handle" aria-hidden="true" />
        {/* Icon + label row - mobile-only (see global.css) - so the
            collapsed pull-tab reads as Apple Maps' own floating search
            capsule (a wide bar you tap or swipe up) rather than a plain
            status label with no visual identity. */}
        <span className="sidebar-reopen__row">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            className="sidebar-reopen__icon"
          >
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="sidebar-reopen__label" aria-hidden="true">
            {status === 'ready'
              ? `${filtered.length} cool spot${filtered.length === 1 ? '' : 's'}`
              : status === 'loading'
                ? progress && progress.viewpointsFound > 0
                  ? `Found ${progress.viewpointsFound} so far…`
                  : 'Searching…'
                : 'View Finder'}
          </span>
        </span>
      </button>
  )

  return (
    <>
      {reopenButton}
      <aside ref={sheetRef} className={`vf-card sidebar${sidebarOpen ? '' : ' sidebar--hidden'}`}>
      {/* Mobile-only (see global.css) swipe-down-to-close target, matching
          how a native bottom sheet's own drag handle behaves - the
          explicit collapse button in the header below still covers
          desktop/non-touch use. The drag handlers live here (the actual
          touch surface) but translate the whole <aside> above via
          sheetRef, not just this row. */}
      <div
        className="sidebar__grabber"
        role="button"
        tabIndex={0}
        aria-label="Hide sidebar"
        {...sheetDragHandlers}
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
        // One scroll region for filters + results together (not just the
        // list on its own) - filters scroll away with everything else
        // instead of permanently eating space above a cramped, separately-
        // scrolling list, which is what made the list hard to see/browse
        // on the shorter mobile sheet.
        <div className="sidebar__scroll">
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
            <div className="sidebar__chip-row">
              <label className="sidebar__checkbox">
                <input type="checkbox" checked={showOsmViewpoints} onChange={toggleShowOsmViewpoints} />
                <span>Tagged viewpoints</span>
              </label>
              <label className="sidebar__checkbox">
                <input type="checkbox" checked={showComputedPeaks} onChange={toggleShowComputedPeaks} />
                <span>Computed peaks</span>
              </label>
              <label className="sidebar__checkbox">
                <input type="checkbox" checked={showPrivateLand} onChange={togglePrivateLand} />
                <span>Private/farmland</span>
              </label>
            </div>

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
                {progress
                  ? `Searching${progress.tilesTotal > 1 ? ` (${progress.tilesCompleted}/${progress.tilesTotal} areas)` : ''}${
                      progress.viewpointsFound > 0 ? ` — found ${progress.viewpointsFound} so far` : ''
                    }…`
                  : 'Loading viewpoints…'}
                {/* A determinate fill only makes sense once there's more
                    than one tile to actually track progress across - a
                    single-tile fetch (the common case) falls back to the
                    original indeterminate animation instead of a bar
                    that's just either 0% or 100%. */}
                {progress && progress.tilesTotal > 1 ? (
                  <div
                    className="sidebar__status-progress sidebar__status-progress--determinate"
                    style={{ width: `${Math.round((progress.tilesCompleted / progress.tilesTotal) * 100)}%` }}
                  />
                ) : (
                  <div className="sidebar__status-progress" />
                )}
              </div>
            )}

            {status === 'error' && (
              <div className="sidebar__status sidebar__status--error" title={error ?? undefined}>
                {friendlyMessage(error ?? '', progress?.tilesTotal ?? null)}
                <button type="button" className="sidebar__retry" onClick={requestViewpointsRefresh}>
                  Try again
                </button>
              </div>
            )}

            {status === 'ready' && (
              <>
                <div className="sidebar__count">
                  {filtered.length} cool spot{filtered.length === 1 ? '' : 's'}
                  {viewpoints.length > 0 && ` (${osmCount} tagged · ${computedCount} computed)`}
                  {filtered.length > MANY_RESULTS_THRESHOLD && ' — zoom in for a clearer view'}
                </div>
                <div className="sidebar__rows">
                  {viewpoints.length === 0 && (
                    <div className="sidebar__empty">No scenic spots found here — try zooming out to search a wider area</div>
                  )}
                  {viewpoints.length > 0 && filtered.length === 0 && (
                    <div className="sidebar__empty">
                      No spots match these filters — found {osmCount} tagged viewpoint{osmCount === 1 ? '' : 's'} and{' '}
                      {computedCount} computed peak{computedCount === 1 ? '' : 's'} here, all filtered out
                    </div>
                  )}
                  {filtered.map((vp) => (
                    <div className="sidebar__row" key={vp.id}>
                      <button type="button" className="sidebar__row-main" onClick={() => flyTo(vp)}>
                        <span
                          className="sidebar__badge"
                          data-category={vp.category}
                          style={{ backgroundColor: CATEGORY_COLOR[vp.category] }}
                          aria-hidden="true"
                        />
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
        </div>
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
    </>
  )
}
