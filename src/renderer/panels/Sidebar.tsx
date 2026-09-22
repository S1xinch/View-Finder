import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useViewFinderStore } from '../state/store'
import { CATEGORY_COLOR, CATEGORY_LABEL } from '../map/categoryStyle'
import { DirectionsView } from './DirectionsView'
import { SearchBar } from './SearchBar'
import { SavedLocations } from './SavedLocations'
import { visibleCenterOffset } from '../map/mapInsets'
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

// Under this much movement a release is a tap, not a swipe (a real finger
// never lands pointerup on the exact pointerdown pixel).
const TAP_THRESHOLD_PX = 8

// A release moving at least this fast commits in the direction of travel
// regardless of how far it actually got. Lowered from 0.35 to 0.25 for
// more responsive close gestures - easier to flick the sheet closed even
// with smaller finger movements.
const FLICK_VELOCITY_PX_PER_MS = 0.25

// A click landing within this long after a real pointer sequence ended on
// the sheet is treated as part of that same gesture, not a fresh one -
// see pointerHandledAtRef in useSheetDrag for why a plain one-shot flag
// isn't enough (a <label>'s native click-forwarding to its checkbox fires
// a second click for one physical tap).
const CLICK_FROM_POINTER_WINDOW_MS = 500

// Kept a little longer than the CSS transform transition (see .sidebar in
// global.css) so the inline transform is only dropped once the snap has
// finished playing out.
const SNAP_SETTLE_MS = 320

// How tall the sheet is when collapsed. Declared in CSS as --vf-sheet-peek
// (which is what the collapsed rule sets max-height to) and read back here
// so the drag maths and the resting position can't drift apart. Measured
// from the real layout on mount - see the layout effect in Sidebar.
function peekHeightOf(el: HTMLElement): number {
  const parsed = Number.parseFloat(getComputedStyle(el).getPropertyValue('--vf-sheet-peek'))
  return Number.isFinite(parsed) ? parsed : 132
}

// Mirrors `max-height: min(65dvh, 65vh)` on the mobile sheet in
// global.css - the drag needs the cap as a number, and a CSS min() in a
// custom property can't be read back resolved.
const SHEET_MAX_VIEWPORT_FRACTION = 0.65

// Drags the ONE sheet between its two resting heights, rather than
// swapping between two separate elements or sliding it off-screen.
// Collapsed is the exact same sheet, just shorter - its bottom edge stays
// anchored in place (see .sidebar's `bottom` in global.css) so it reads
// as a small rounded card floating just above the screen edge, and
// dragging up grows it back toward full height. That's what makes it
// feel continuous instead of popping between two different things, and
// (unlike translating it downward off-screen) it's never actually
// off-screen or square-cornered at rest.
//
// The sheet's height is mutated directly rather than through React
// state: a re-render per pointermove would be both wasted work and a
// frame behind the finger. CSS owns the resting heights and the snap
// transition (see .sidebar / .sidebar--hidden in global.css); this
// disables that transition for the duration of the drag so the sheet
// tracks 1:1, then restores it and sets the destination so the snap
// animates. The inline height is dropped a beat later (SNAP_SETTLE_MS)
// once React has applied the matching class, so handing control back to
// the stylesheet is invisible instead of a jump.
//
// setPointerCapture keeps pointerup coming to this element even if the
// finger drifts off it mid-drag. onClick remains only for keyboard
// activation (Enter/Space fires a click with no pointer sequence at all);
// pointerHandledAtRef stops a real gesture's trailing click(s) - plural,
// see its own comment - from double-toggling.
// Finger movement past this, while the scroll container is already at
// scrollTop 0, hands the gesture off from "tried to scroll further up,
// there's nothing there" to "closing the sheet". Reduced to 8px for faster
// responsiveness to close gestures - users can still scroll normally since
// this only triggers when scroll is already at top AND they keep pulling.
const OVERSCROLL_START_PX = 8

// Momentum for the manually-driven list scroll (see scrollHandlers) - the
// browser's own inertia is gone once it no longer owns the scrolling, so a
// flick has to be continued here. Friction matches iOS's normal
// deceleration rate (0.998 per ms); only the last ~100ms of movement
// counts, so a finger that stops before lifting doesn't fling.
const MOMENTUM_FRICTION_PER_MS = 0.998
const MOMENTUM_SAMPLE_WINDOW_MS = 100
const MOMENTUM_START_PX_PER_MS = 0.2
const MOMENTUM_STOP_PX_PER_MS = 0.02
const MOMENTUM_MAX_PX_PER_MS = 8

function useSheetDrag(
  sheetRef: React.RefObject<HTMLElement | null>,
  scrollRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void
): {
  zoneHandlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
    onClick: (e: React.MouseEvent) => void
  }
  scrollHandlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
    onPointerCancel: (e: React.PointerEvent) => void
    onClickCapture: (e: React.MouseEvent) => void
  }
} {
  // A timestamp, not a one-shot boolean: clicking a <label> (the filter
  // chips) makes the browser fire a SECOND click, forwarded to the
  // checkbox it wraps, for one physical tap. A boolean flag that resets
  // itself the first time onClick sees it correctly swallows that first
  // click but then leaves the forwarded second one unguarded, so it fell
  // through to setOpen() and closed the sheet on every filter-chip tap.
  // Comparing timestamps instead means every click within the window
  // after a real pointer sequence is swallowed, not just the first.
  const pointerHandledAtRef = useRef(0)
  const startYRef = useRef<number | null>(null)
  const startTimeRef = useRef(0)
  // scrollTop at the moment the current touch began on the list. Repeated
  // attempts to fix this by reacting to the *browser's own* scrollTop
  // (waiting for it to settle at 0, then measuring a pull from there) kept
  // failing in different ways - the real problem was relying on native
  // touch-scrolling at all. A genuinely long list is exactly the case
  // where the browser's own compositor claims a touch as its own native
  // scroll gesture before this handler ever gets a say (confirmed via a
  // debug overlay on a real device: touching blank space fired an
  // immediate pointercancel; touching a real button/link didn't, because
  // interactive elements get their own brief tap-vs-scroll grace delay
  // from the browser that plain content doesn't). scrollHandlers now
  // drives scrollTop itself from this baseline instead of trusting native
  // scrolling to do it - see onPointerMove - so there's no native gesture
  // left to race against in the first place.
  const startScrollTopRef = useRef(0)
  const baseHeightRef = useRef(0)
  const peekHeightRef = useRef(0)
  const openHeightRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout>>()
  // Which element actually owns the in-progress gesture (zone or scroll
  // container) - only that one's pointerup/pointermove should act on it,
  // since both handler sets can see events bubbling through the sheet.
  const activeSourceRef = useRef<'zone' | 'scroll' | null>(null)
  const moveSamplesRef = useRef<{ y: number; t: number }[]>([])
  const momentumFrameRef = useRef<number | null>(null)
  // A tap that stops a gliding list shouldn't also activate the row under
  // the finger - same as native scrolling.
  const suppressClickRef = useRef(false)

  const stopMomentum = (): boolean => {
    if (momentumFrameRef.current == null) return false
    cancelAnimationFrame(momentumFrameRef.current)
    momentumFrameRef.current = null
    return true
  }

  const startMomentum = (scrollEl: HTMLElement, initialVelocity: number): void => {
    let velocity = Math.max(-MOMENTUM_MAX_PX_PER_MS, Math.min(MOMENTUM_MAX_PX_PER_MS, initialVelocity))
    let last = performance.now()
    const step = (now: number): void => {
      const dt = Math.max(0, now - last)
      last = now
      velocity *= Math.pow(MOMENTUM_FRICTION_PER_MS, dt)
      const max = scrollEl.scrollHeight - scrollEl.clientHeight
      const next = Math.min(Math.max(scrollEl.scrollTop + velocity * dt, 0), max)
      scrollEl.scrollTop = next
      if (Math.abs(velocity) < MOMENTUM_STOP_PX_PER_MS || next <= 0 || next >= max) {
        momentumFrameRef.current = null
        return
      }
      momentumFrameRef.current = requestAnimationFrame(step)
    }
    momentumFrameRef.current = requestAnimationFrame(step)
  }

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      if (momentumFrameRef.current != null) cancelAnimationFrame(momentumFrameRef.current)
    },
    []
  )

  const beginDrag = (clientY: number, timeStamp: number): void => {
    const el = sheetRef.current
    if (!el) return
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    peekHeightRef.current = peekHeightOf(el)
    // While open, the sheet is already rendered at its real resting height -
    // measure it directly rather than re-deriving it from window.innerHeight.
    // The two can disagree on a real phone (dvh tracks the *current* visible
    // viewport as the browser chrome shows/hides; window.innerHeight doesn't
    // always move with it the same way), which made a drag that let go
    // without closing snap the sheet to a taller height than it was already
    // showing - only the collapsed case still needs the formula estimate,
    // since the open height isn't actually rendered anywhere to measure yet.
    openHeightRef.current = open ? el.getBoundingClientRect().height : window.innerHeight * SHEET_MAX_VIEWPORT_FRACTION
    baseHeightRef.current = open ? openHeightRef.current : peekHeightRef.current
    startYRef.current = clientY
    startTimeRef.current = timeStamp
    el.style.transition = 'none'
  }

  const updateDrag = (clientY: number): void => {
    const el = sheetRef.current
    if (!el || startYRef.current == null) return
    // Finger moving up (negative delta) should grow the sheet.
    const next = baseHeightRef.current - (clientY - startYRef.current)
    el.style.height = `${Math.min(Math.max(next, peekHeightRef.current), openHeightRef.current)}px`
  }

  const endDrag = (clientY: number, timeStamp: number): void => {
    const el = sheetRef.current
    const startY = startYRef.current
    const source = activeSourceRef.current
    startYRef.current = null
    activeSourceRef.current = null
    pointerHandledAtRef.current = timeStamp
    if (!el || startY == null) return

    const delta = clientY - startY
    const velocity = delta / Math.max(1, timeStamp - startTimeRef.current)
    const span = openHeightRef.current - peekHeightRef.current
    let toOpen: boolean
    if (source === 'zone' && Math.abs(delta) < TAP_THRESHOLD_PX) {
      // Only the zone (grabber/header) can start a "drag" on a plain tap
      // with zero movement - it begins tracking on pointerdown regardless,
      // so this fallback is what makes a tap there still toggle. The
      // scroll handoff never starts from a stationary touch: reaching it
      // already required a real overscroll past OVERSCROLL_START_PX before
      // rebasing the start point here, so a small delta right after that
      // handoff is a real (if short) pull, not a fresh tap - reading it as
      // one made letting go right after the handoff silently close the
      // sheet on what was meant to be an ordinary scroll attempt.
      toOpen = !open
    } else if (Math.abs(velocity) >= FLICK_VELOCITY_PX_PER_MS) {
      // Flicked - go where it was thrown, however far it actually got.
      toOpen = velocity < 0
    } else {
      // Dragged and let go: settle to whichever resting height the sheet
      // ended up nearest.
      toOpen = baseHeightRef.current - delta > peekHeightRef.current + span / 2
    }

    el.style.transition = ''
    el.style.height = `${toOpen ? openHeightRef.current : peekHeightRef.current}px`
    settleTimerRef.current = setTimeout(() => {
      if (sheetRef.current) sheetRef.current.style.height = ''
    }, SNAP_SETTLE_MS)
    if (toOpen !== open) setOpen(toOpen)
  }

  // A real touchscreen doesn't always deliver a matching pointerup for a
  // captured pointer - the OS/browser can cancel the sequence outright
  // (an edge-swipe-back gesture, a multi-touch conflict, the browser's own
  // scroll-vs-gesture arbitration). Without this, a cancelled drag left
  // activeSourceRef/startYRef pointing at that dead gesture forever, so
  // the *next* touch - often just an ordinary attempt to scroll the list -
  // inherited stale drag state and got misread as a continuation of it,
  // snapping the sheet to some unrelated height out of nowhere. Unlike
  // endDrag this never commits to open/closed: a cancelled gesture carries
  // no real intent, so it just abandons the drag and lets the current
  // resting state's own CSS transition put the sheet back where it was.
  const cancelDrag = (timeStamp: number): void => {
    const el = sheetRef.current
    // pointercancel isn't only "the OS interrupted an actual drag" - most
    // touch browsers (Chrome on Android especially) also fire it as their
    // normal way of handing a touch off to native scrolling, which means
    // it fires on most ordinary scroll gestures too, not just interrupted
    // ones. Resetting the sheet's inline height/transition unconditionally
    // here meant every plain scroll of the list did that reset as a side
    // effect, fighting whatever the CSS transition was doing at that exact
    // moment and reading as scrolling that won't run smoothly. Only touch
    // the sheet's own style when a drag we actually started is what's
    // being cancelled - a stray cancel from ordinary scrolling, which
    // never touched activeSourceRef, has nothing on the sheet to undo.
    const wasDragging = activeSourceRef.current !== null
    startYRef.current = null
    activeSourceRef.current = null
    pointerHandledAtRef.current = timeStamp
    if (!el || !wasDragging) return
    el.style.transition = ''
    el.style.height = ''
  }

  return {
    // The grabber + header row (logo, empty space - real controls like
    // the collapse button are excluded) are a drag surface at all times,
    // open or collapsed - same for the footer (GitHub/download/
    // troubleshooting links) at the bottom of the open sheet, which sits
    // outside .sidebar__scroll (see its own comment) and so isn't covered
    // by scrollHandlers' overscroll-to-close either. Without this, the
    // footer was a dead zone once open: not the always-on zone (header/
    // grabber only) and not part of the scrollable content, so a
    // close-drag starting there did nothing at all - the sheet only
    // responded to a swipe started at the top, never lower down. This is
    // the "always works" zone; scrollHandlers below covers the rest of
    // the open sheet via overscroll instead.
    zoneHandlers: {
      onPointerDown: (e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, button, a, textarea, select')) return
        const onDragZone = target.closest('.sidebar__grabber, .sidebar__header, .sidebar__footer') != null
        if (!onDragZone && open) return
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* not a real pointer session (e.g. a test) - ignore */
        }
        activeSourceRef.current = 'zone'
        beginDrag(e.clientY, e.timeStamp)
      },
      onPointerMove: (e) => {
        if (activeSourceRef.current !== 'zone') return
        updateDrag(e.clientY)
      },
      onPointerUp: (e) => {
        // Recorded unconditionally, even when this gesture never became a
        // real drag (e.g. a plain click on a button elsewhere in the
        // sheet) - the click event that always follows a pointerup would
        // otherwise see a stale timestamp from whenever the *last* real
        // drag ended and incorrectly toggle the sheet again on every
        // ordinary click, not just ones this handler actually acted on.
        pointerHandledAtRef.current = e.timeStamp
        if (activeSourceRef.current !== 'zone') return
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* already released, or never really captured - ignore */
        }
        endDrag(e.clientY, e.timeStamp)
      },
      onPointerCancel: (e) => cancelDrag(e.timeStamp),
      onClick: (e) => {
        if (e.timeStamp - pointerHandledAtRef.current < CLICK_FROM_POINTER_WINDOW_MS) return
        setOpen(!open)
      }
    },
    // Real "pull down past the top of the list to close" behavior, the
    // way Apple/Google Maps' own sheet works: while there's still content
    // above to scroll back to (scrollTop > 0), a downward drag just
    // scrolls normally, untouched. Only once the container is already
    // pinned to its top AND the user keeps pulling down past
    // OVERSCROLL_START_PX does the gesture hand off to closing the sheet -
    // at that exact point (not from the original touch-down position),
    // so the handoff has no visible jump.
    scrollHandlers: {
      onPointerDown: (e) => {
        // Unlike zoneHandlers, this never captures the pointer or starts a
        // drag here - it only records where the touch began, so a real row
        // button/link tap underneath is never disturbed either way. Most of
        // the visible list *is* buttons (each row is one), so excluding
        // them here (as zoneHandlers correctly does, to avoid breaking
        // their tap) meant a pull-to-close gesture that began on a row -
        // the overwhelmingly common case - never even started tracking,
        // and so could never hand off to closing no matter how far it was
        // pulled. Whether this becomes a real drag is still decided later,
        // in onPointerMove, purely from actual movement + scrollTop.
        if (!open) return
        suppressClickRef.current = stopMomentum()
        moveSamplesRef.current = []
        // A slider/checkbox owns its own drag - otherwise any vertical drift
        // while sliding gets read as scroll/close-drag movement.
        if ((e.target as HTMLElement).closest('input, select, textarea')) {
          startYRef.current = null
          return
        }
        startYRef.current = e.clientY
        startTimeRef.current = e.timeStamp
        activeSourceRef.current = null
        startScrollTopRef.current = scrollRef.current ? scrollRef.current.scrollTop : 0
      },
      // touch-action: none on .sidebar__scroll (mobile - see global.css)
      // means the browser never touches this element's scrolling at all
      // on touch, so this drives scrollTop itself from the fixed
      // pointerdown baseline instead of reading back whatever the browser
      // decided: dragging within bounds scrolls the list exactly like
      // native scrolling would, and the exact instant the drag would pull
      // scrollTop negative, that excess becomes the close-drag distance
      // instead - one continuous calculation, not two mechanisms handing
      // off to each other. This is also what a scroll-to-top-mid-gesture
      // needs (see startScrollTopRef's own comment): the overscroll
      // amount is always "how far past the boundary", never "how far
      // the finger has moved in total", so it's naturally zero at the
      // exact moment the top is reached regardless of how far the list
      // had to scroll to get there.
      onPointerMove: (e) => {
        const scrollEl = scrollRef.current
        if (!scrollEl || startYRef.current == null) return
        if (activeSourceRef.current === 'scroll') {
          e.preventDefault()
          updateDrag(e.clientY)
          return
        }
        if (activeSourceRef.current !== null) return
        e.preventDefault()
        const samples = moveSamplesRef.current
        samples.push({ y: e.clientY, t: e.timeStamp })
        while (samples.length > 2 && e.timeStamp - samples[0].t > MOMENTUM_SAMPLE_WINDOW_MS) samples.shift()
        const dy = e.clientY - startYRef.current
        const desiredScrollTop = startScrollTopRef.current - dy
        if (desiredScrollTop > 0) {
          scrollEl.scrollTop = desiredScrollTop
          return
        }
        scrollEl.scrollTop = 0
        const overscrolled = -desiredScrollTop
        if (overscrolled > OVERSCROLL_START_PX) {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* not a real pointer session (e.g. a test) - ignore */
          }
          activeSourceRef.current = 'scroll'
          beginDrag(e.clientY, e.timeStamp)
        }
      },
      onPointerUp: (e) => {
        // Same unconditional record as zoneHandlers.onPointerUp (and this
        // event bubbles up to that handler too, which would otherwise be
        // the only one to set it) - belt and suspenders so this stays
        // correct even if that changes later.
        pointerHandledAtRef.current = e.timeStamp
        if (activeSourceRef.current !== 'scroll') {
          const wasScrolling = startYRef.current != null
          startYRef.current = null
          const scrollEl = scrollRef.current
          if (!wasScrolling || !scrollEl || e.pointerType !== 'touch') return
          const recent = moveSamplesRef.current.filter((s) => e.timeStamp - s.t <= MOMENTUM_SAMPLE_WINDOW_MS)
          moveSamplesRef.current = []
          if (recent.length < 2) return
          const first = recent[0]
          const last = recent[recent.length - 1]
          const velocity = (first.y - last.y) / Math.max(1, last.t - first.t)
          if (Math.abs(velocity) >= MOMENTUM_START_PX_PER_MS) startMomentum(scrollEl, velocity)
          return
        }
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* already released, or never really captured - ignore */
        }
        endDrag(e.clientY, e.timeStamp)
      },
      onPointerCancel: (e) => cancelDrag(e.timeStamp),
      onClickCapture: (e) => {
        if (!suppressClickRef.current) return
        suppressClickRef.current = false
        e.preventDefault()
        e.stopPropagation()
      }
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
  const setSidebarOpen = useViewFinderStore((s) => s.setSidebarOpen)
  const showPrivateLand = useViewFinderStore((s) => s.showPrivateLand)
  const togglePrivateLand = useViewFinderStore((s) => s.togglePrivateLand)
  const showOsmViewpoints = useViewFinderStore((s) => s.showOsmViewpoints)
  const toggleShowOsmViewpoints = useViewFinderStore((s) => s.toggleShowOsmViewpoints)
  const showComputedPeaks = useViewFinderStore((s) => s.showComputedPeaks)
  const toggleShowComputedPeaks = useViewFinderStore((s) => s.toggleShowComputedPeaks)
  const routeDestination = useViewFinderStore((s) => s.routeDestination)
  const requestRoute = useViewFinderStore((s) => s.requestRoute)
  const clearRoute = useViewFinderStore((s) => s.clearRoute)
  const requestViewpointsRefresh = useViewFinderStore((s) => s.requestViewpointsRefresh)

  // On phone portrait the sheet IS the collapsed bar - it just sits pushed
  // down to its peek height (see .sidebar--hidden in global.css) - so one
  // element and one drag hook cover both states. The separate corner
  // button is desktop/landscape only (hidden on phone portrait in CSS)
  // and needs no drag at all: it's a plain click target there.
  const sheetRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { zoneHandlers, scrollHandlers } = useSheetDrag(sheetRef, scrollRef, sidebarOpen, setSidebarOpen)

  // The collapsed sheet should peek exactly far enough to show everything
  // down to the bottom of the search field. Measuring that (rather than
  // hard-coding a height) keeps it correct across font scaling, a wrapped
  // title, and locale-driven text length - any of which would otherwise
  // clip the search box or leave dead space under it. --vf-sheet-peek's
  // value in global.css is only the pre-measurement fallback.
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return

    const measure = (): void => {
      const search = sheet.querySelector('.search-bar')
      if (!search) return
      // Measured while open (the sheet's natural, un-shrunk layout), so
      // this is just "how far down the search field's bottom edge sits" -
      // the same number collapsed height needs to target.
      const peek = search.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top
      if (peek > 0) sheet.style.setProperty('--vf-sheet-peek', `${Math.round(peek)}px`)
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

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
    if (!map) return
    map.flyTo({
      center: [vp.lng, vp.lat],
      zoom: Math.max(map.getZoom(), 14),
      offset: visibleCenterOffset(map),
      duration: 800
    })
  }

  return (
    <>
      {/* Desktop and landscape only - phone portrait hides this entirely
          (see global.css) because there the sheet itself stays on screen,
          peeking, instead of being replaced by a separate control. */}
      <button
        type="button"
        className={`sidebar-reopen vf-card${status === 'loading' ? ' sidebar-reopen--loading' : ''}${sidebarOpen ? ' sidebar-reopen--hidden' : ''}`}
        onClick={() => setSidebarOpen(true)}
        aria-label={status === 'loading' ? 'Show sidebar (loading viewpoints)' : 'Show sidebar'}
      >
        <span className="sidebar-reopen__arrow" aria-hidden="true">
          ›
        </span>
      </button>
      {/* Phone-portrait drag surface (hidden elsewhere, see global.css):
          drags the whole sheet between peeking and open via sheetRef.
          zoneHandlers live on the whole <aside> (not just the grabber
          row below) so any non-interactive spot on the collapsed card,
          or the grabber/header while open, works - not just a thin
          handle strip. The scrollable body below has its own separate
          scrollHandlers (see .sidebar__scroll) for pull-down-past-the-
          top-of-the-list overscroll-to-close, the way Apple/Google
          Maps' own sheet works. The explicit collapse button in the
          header still covers desktop/non-touch use. */}
      <aside
        ref={sheetRef}
        className={`vf-card sidebar${sidebarOpen ? '' : ' sidebar--hidden'}`}
        {...zoneHandlers}
      >
      <div
        className="sidebar__grabber"
        role="button"
        tabIndex={0}
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') toggleSidebar()
        }}
      >
        <span className="sidebar__handle" aria-hidden="true" />
      </div>

      {/* Just the mark, small and quiet in the corner - "View Finder" (the
          h1 + subtitle this replaces) is what the mark itself already
          says, and dropping the text row means the search field below
          sits noticeably higher instead of under a full title block. The
          app's actual name/description still exist for anyone who needs
          them literally: the <title> tag and the mark's alt text below. */}
      {routeDestination ? (
        <header className="sidebar__header sidebar__header--directions" title={`Directions to ${routeDestination.name || 'destination'}`}>
          <div className="sidebar__directions-title">
            {routeDestination.name || 'Directions'}
          </div>
          <button type="button" className="sidebar__cancel-route" onClick={clearRoute} aria-label="Cancel directions">
            ×
          </button>
        </header>
      ) : (
        <header className="sidebar__header" title="View Finder — scenic high ground, reachable by car" aria-label="View Finder">
        </header>
      )}

      {/* The search field is inside the strip that stays visible while the
          sheet is collapsed, so it can be tapped without opening the sheet
          first - but its results dropdown would render below the fold. Any
          focus landing in here opens the sheet so the results have
          somewhere to go. */}
      {!routeDestination && (
        <div
          onFocus={() => {
            if (!sidebarOpen) setSidebarOpen(true)
          }}
        >
          <SearchBar />
        </div>
      )}

      {routeDestination ? (
        <div className="sidebar__body">
          <DirectionsView />
        </div>
      ) : (
        // One scroll region for filters + results together (not just the
        // list on its own) - filters scroll away with everything else
        // instead of permanently eating space above a cramped, separately-
        // scrolling list, which is what made the list hard to see/browse
        // on the shorter mobile sheet. Also the overscroll-to-close
        // surface on phone portrait - see scrollHandlers/useSheetDrag.
        <div className="sidebar__scroll" ref={scrollRef} {...scrollHandlers}>
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

          <SavedLocations />
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
