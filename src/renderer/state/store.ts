import { useMemo } from 'react'
import { create } from 'zustand'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { ExcludedLandArea, RouteResult, Viewpoint, ViewpointsProgress } from '@shared/ipcContract'
import { loadTheme, saveTheme, type ThemeName } from '../themes'

export type ViewpointsStatus = 'idle' | 'zoomed-out' | 'loading' | 'error' | 'ready'
export type RouteStatus = 'idle' | 'loading' | 'error' | 'ready'

// Matches core/scoring/roadReachability.ts's MAX_WALK_IN_METERS - the
// renderer doesn't import core/ directly (no path alias set up for it in
// the web tsconfig, and reaching across that boundary casually would work
// against the whole point of keeping core/ the single source of truth for
// business logic), so this is the slider's upper bound, not a re-statement
// of the actual filtering rule enforced in main/.
const MAX_ROAD_DISTANCE_SLIDER_METERS = 500

export interface FilterState {
  minElevationMeters: number
  maxDistanceToRoadMeters: number
}

export interface UserLocation {
  lat: number
  lng: number
  accuracyMeters: number
}

interface ViewFinderStore {
  map: MapLibreMap | null
  setMap: (map: MapLibreMap | null) => void

  viewpoints: Viewpoint[]
  viewpointsStatus: ViewpointsStatus
  viewpointsError: string | null
  // Reset to null on every new fetch attempt (not just left stale from
  // the last one) so the loading UI never shows leftover numbers from a
  // previous, different viewport while a fresh request is still waiting
  // on its own first tile.
  viewpointsProgress: ViewpointsProgress | null
  setViewpointsLoading: () => void
  setViewpointsProgress: (progress: ViewpointsProgress) => void
  setViewpointsZoomedOut: () => void
  setViewpointsLoaded: (viewpoints: Viewpoint[]) => void
  setViewpointsError: (message: string) => void
  // Bumped to force an immediate re-fetch of the current view, bypassing
  // the pan-settle debounce - useViewpointsSync watches this value (see
  // its own effect) rather than exposing its internal fetch function
  // directly, so both the manual "Search this area" button and the
  // error state's "Try again" button can trigger the same one code path
  // without the store needing to know anything about map/Overpass.
  viewpointsRefreshNonce: number
  requestViewpointsRefresh: () => void

  filters: FilterState
  setMinElevationMeters: (value: number) => void
  setMaxDistanceToRoadMeters: (value: number) => void

  sidebarOpen: boolean
  toggleSidebar: () => void
  // Explicit setter alongside the toggle - the drag gesture decides an
  // absolute target state from where the sheet was released (and the
  // search field opens the sheet on focus), neither of which is a
  // "flip whatever it currently is" operation.
  setSidebarOpen: (open: boolean) => void

  showPrivateLand: boolean
  togglePrivateLand: () => void
  excludedLandAreas: ExcludedLandArea[]
  setExcludedLandAreas: (areas: ExcludedLandArea[]) => void

  // Lets a user isolate OSM-tagged spots ("viewpoint"/"peak"/"alpine_hut")
  // from elevation-derived ones ("computed_peak") or vice versa - useful
  // since the two have very different confidence (OSM is human-confirmed,
  // computed peaks are a best-effort guess from terrain data alone).
  showOsmViewpoints: boolean
  toggleShowOsmViewpoints: () => void
  showComputedPeaks: boolean
  toggleShowComputedPeaks: () => void

  locationTracking: boolean
  toggleLocationTracking: () => void
  userLocation: UserLocation | null
  locationError: string | null
  setLocation: (location: UserLocation) => void
  setLocationError: (message: string) => void

  routeDestination: Viewpoint | null
  route: RouteResult | null
  routeStatus: RouteStatus
  routeError: string | null
  // Bumped by every requestRoute, even to the same destination - useRoute
  // keys its fetch on this, since the destination object alone doesn't
  // change when the same spot is asked for again.
  routeRequestNonce: number
  // 0 = OSRM's primary route, n = route.alternatives[n - 1]. Lives here (not
  // in DirectionsView) so the map line, the step list and navigation all
  // follow the same choice - read it through selectActiveRoute.
  routeChoice: number
  setRouteChoice: (choice: number) => void
  requestRoute: (destination: Viewpoint) => void
  clearRoute: () => void
  setRouteLoading: () => void
  setRouteLoaded: (route: RouteResult) => void
  setRouteError: (message: string) => void
  // Distinguishes "here's the route overview" (routeStatus === 'ready') from
  // "actually driving it" - flipped on by the DirectionsView's own Start
  // button once the user is ready to go. LocationLayer.tsx only takes over
  // the camera (follow + zoom) and shows a heading arrow while this is true.
  navigating: boolean
  startNavigation: () => void

  satelliteView: boolean
  toggleSatelliteView: () => void

  theme: ThemeName
  setTheme: (theme: ThemeName) => void

  // The one marker the user placed themselves (click on desktop, press and
  // hold on touch - see ViewpointLayer). A new drop replaces it.
  droppedPin: Viewpoint | null
  dropPin: (lat: number, lng: number) => void
  setDroppedPin: (pin: Viewpoint | null) => void

  // Saved on this device only (localStorage) - no account needed.
  savedSpots: Viewpoint[]
  toggleSavedSpot: (spot: Viewpoint) => void

  // The user's own corrections to a spot's access flag, by spot id - also
  // device-only. Applied on display (withAccessReports), so clearing one
  // brings back whatever the data said.
  accessReports: Record<string, AccessReport>
  setAccessReport: (id: string, report: AccessReport | null) => void
}

export type AccessReport = 'open' | 'closed'

const ACCESS_REPORTS_KEY = 'vf-access-reports'

function loadAccessReports(): Record<string, AccessReport> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACCESS_REPORTS_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, AccessReport] => e[1] === 'open' || e[1] === 'closed')
    )
  } catch {
    return {}
  }
}

export function withAccessReport(vp: Viewpoint, reports: Record<string, AccessReport>): Viewpoint {
  const report = reports[vp.id]
  if (report === 'open') return { ...vp, restricted: undefined }
  if (report === 'closed') return { ...vp, restricted: vp.restricted ?? 'reported' }
  return vp
}

// The current drive, kept so it survives the app being closed or losing
// signal (useRoute keeps it on screen when re-routing fails offline). Ends
// with clearRoute, or goes stale after half a day.
const ACTIVE_DRIVE_KEY = 'vf-active-drive'
const DRIVE_MAX_AGE_MS = 12 * 60 * 60 * 1000

interface SavedDrive {
  at: number
  destination: Viewpoint
  route: RouteResult
}

function loadActiveDrive(): SavedDrive | null {
  try {
    const d = JSON.parse(localStorage.getItem(ACTIVE_DRIVE_KEY) ?? 'null') as SavedDrive | null
    const valid =
      typeof d?.at === 'number' &&
      Date.now() - d.at < DRIVE_MAX_AGE_MS &&
      typeof d.destination?.id === 'string' &&
      typeof d.destination.lat === 'number' &&
      typeof d.destination.lng === 'number' &&
      Array.isArray(d.route?.coordinates) &&
      Array.isArray(d.route.steps)
    return valid ? d : null
  } catch {
    return null
  }
}

function persistActiveDrive(drive: SavedDrive | null): void {
  try {
    if (drive) localStorage.setItem(ACTIVE_DRIVE_KEY, JSON.stringify(drive))
    else localStorage.removeItem(ACTIVE_DRIVE_KEY)
  } catch {
    // Storage full/blocked - the drive just won't survive a reload.
  }
}

const restoredDrive = loadActiveDrive()

const SAVED_SPOTS_KEY = 'vf-saved-spots'

function loadSavedSpots(): Viewpoint[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_SPOTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    // Stored data is untrusted-ish (older versions, manual edits) - keep only
    // entries that still have what the list and map need.
    return parsed.filter(
      (s): s is Viewpoint =>
        typeof s?.id === 'string' && typeof s.lat === 'number' && typeof s.lng === 'number' && typeof s.category === 'string'
    )
  } catch {
    return []
  }
}

function persistSavedSpots(spots: Viewpoint[]): void {
  try {
    localStorage.setItem(SAVED_SPOTS_KEY, JSON.stringify(spots))
  } catch {
    // Storage full/blocked - the list still works for this session.
  }
}

export const useViewFinderStore = create<ViewFinderStore>((set) => ({
  map: null,
  setMap: (map) => set({ map }),

  viewpoints: [],
  viewpointsStatus: 'idle',
  viewpointsError: null,
  viewpointsProgress: null,
  setViewpointsLoading: () => set({ viewpointsStatus: 'loading', viewpointsError: null, viewpointsProgress: null }),
  setViewpointsProgress: (viewpointsProgress) => set({ viewpointsProgress }),
  setViewpointsZoomedOut: () =>
    set({ viewpoints: [], viewpointsStatus: 'zoomed-out', viewpointsError: null, viewpointsProgress: null }),
  setViewpointsLoaded: (viewpoints) =>
    set({ viewpoints, viewpointsStatus: 'ready', viewpointsError: null, viewpointsProgress: null }),
  // Progress is deliberately NOT cleared here (unlike the other status
  // setters) - the error UI wants to know how many tiles the failed
  // request was covering, to hint "try zooming in" when it was a lot.
  // It gets overwritten by the next setViewpointsLoading() regardless, so
  // it can never leak into a genuinely new/different request's display.
  setViewpointsError: (message) => set({ viewpointsStatus: 'error', viewpointsError: message }),
  viewpointsRefreshNonce: 0,
  requestViewpointsRefresh: () => set((s) => ({ viewpointsRefreshNonce: s.viewpointsRefreshNonce + 1 })),

  filters: { minElevationMeters: 0, maxDistanceToRoadMeters: MAX_ROAD_DISTANCE_SLIDER_METERS },
  setMinElevationMeters: (value) => set((s) => ({ filters: { ...s.filters, minElevationMeters: value } })),
  setMaxDistanceToRoadMeters: (value) => set((s) => ({ filters: { ...s.filters, maxDistanceToRoadMeters: value } })),

  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  showPrivateLand: false,
  togglePrivateLand: () => set((s) => ({ showPrivateLand: !s.showPrivateLand })),
  excludedLandAreas: [],
  setExcludedLandAreas: (excludedLandAreas) => set({ excludedLandAreas }),

  showOsmViewpoints: true,
  toggleShowOsmViewpoints: () => set((s) => ({ showOsmViewpoints: !s.showOsmViewpoints })),
  showComputedPeaks: true,
  toggleShowComputedPeaks: () => set((s) => ({ showComputedPeaks: !s.showComputedPeaks })),

  // A restored drive needs the live location, same as requestRoute.
  locationTracking: restoredDrive !== null,
  toggleLocationTracking: () =>
    set((s) => ({ locationTracking: !s.locationTracking, locationError: null })),
  userLocation: null,
  locationError: null,
  setLocation: (userLocation) => set({ userLocation, locationError: null }),
  setLocationError: (message) => set({ locationError: message }),

  routeDestination: restoredDrive?.destination ?? null,
  route: restoredDrive?.route ?? null,
  routeStatus: restoredDrive ? 'ready' : 'idle',
  routeError: null,
  // Actually fetching happens in useRoute.ts (keyed on routeDestination +
  // userLocation) - this just records what was asked for, the same
  // separation useViewpointsSync already uses between "what's wanted" and
  // "the effect that fetches it". Also turns location tracking on (a no-op
  // if it's already on) so the user doesn't have to separately find the
  // locate button before directions can work.
  routeRequestNonce: 0,
  routeChoice: 0,
  setRouteChoice: (routeChoice) => set({ routeChoice }),
  requestRoute: (destination) =>
    set((s) => ({
      locationTracking: true,
      routeDestination: destination,
      routeRequestNonce: s.routeRequestNonce + 1,
      route: null,
      routeChoice: 0,
      routeStatus: 'idle',
      routeError: null,
      navigating: false
    })),
  clearRoute: () => {
    persistActiveDrive(null)
    set({ routeDestination: null, route: null, routeChoice: 0, routeStatus: 'idle', routeError: null, navigating: false })
  },
  setRouteLoading: () => set({ routeStatus: 'loading', routeError: null }),
  setRouteLoaded: (route) =>
    set((s) => {
      if (s.routeDestination) persistActiveDrive({ at: Date.now(), destination: s.routeDestination, route })
      return { route, routeChoice: 0, routeStatus: 'ready', routeError: null }
    }),
  setRouteError: (message) => set({ routeStatus: 'error', routeError: message }),
  navigating: false,
  startNavigation: () => set({ navigating: true }),

  satelliteView: false,
  toggleSatelliteView: () => set((s) => ({ satelliteView: !s.satelliteView })),

  theme: loadTheme(),
  setTheme: (theme) => {
    saveTheme(theme)
    set({ theme })
  },

  droppedPin: null,
  dropPin: (lat, lng) =>
    set({
      droppedPin: {
        id: `pin:${lat.toFixed(5)},${lng.toFixed(5)}`,
        name: 'Dropped pin',
        lat,
        lng,
        category: 'dropped_pin',
        tags: {}
      }
    }),
  setDroppedPin: (droppedPin) => set({ droppedPin }),

  savedSpots: loadSavedSpots(),
  toggleSavedSpot: (spot) =>
    set((s) => {
      const savedSpots = s.savedSpots.some((saved) => saved.id === spot.id)
        ? s.savedSpots.filter((saved) => saved.id !== spot.id)
        : // Newest first; raw OSM tags dropped - nothing reads them and they
          // can be large.
          [{ ...spot, tags: {} }, ...s.savedSpots]
      persistSavedSpots(savedSpots)
      return { savedSpots }
    }),

  accessReports: loadAccessReports(),
  setAccessReport: (id, report) =>
    set((s) => {
      const accessReports = { ...s.accessReports }
      if (report) accessReports[id] = report
      else delete accessReports[id]
      try {
        localStorage.setItem(ACCESS_REPORTS_KEY, JSON.stringify(accessReports))
      } catch {
        // Storage full/blocked - still applies for this session.
      }
      return { accessReports }
    })
}))

// A spot list with the user's access corrections applied.
export function useWithAccessReports(spots: Viewpoint[]): Viewpoint[] {
  const reports = useViewFinderStore((s) => s.accessReports)
  return useMemo(() => spots.map((vp) => withAccessReport(vp, reports)), [spots, reports])
}

export function selectActiveRoute(s: Pick<ViewFinderStore, 'route' | 'routeChoice'>): RouteResult | null {
  if (!s.route || s.routeChoice === 0) return s.route
  return s.route.alternatives?.[s.routeChoice - 1] ?? s.route
}

export { MAX_ROAD_DISTANCE_SLIDER_METERS }
