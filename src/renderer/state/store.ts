import { create } from 'zustand'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { ExcludedLandArea, RouteResult, Viewpoint, ViewpointsProgress } from '@shared/ipcContract'

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

  showPrivateLand: boolean
  togglePrivateLand: () => void
  excludedLandAreas: ExcludedLandArea[]
  setExcludedLandAreas: (areas: ExcludedLandArea[]) => void

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
  requestRoute: (destination: Viewpoint) => void
  clearRoute: () => void
  setRouteLoading: () => void
  setRouteLoaded: (route: RouteResult) => void
  setRouteError: (message: string) => void

  satelliteView: boolean
  toggleSatelliteView: () => void
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
  setViewpointsError: (message) => set({ viewpointsStatus: 'error', viewpointsError: message, viewpointsProgress: null }),
  viewpointsRefreshNonce: 0,
  requestViewpointsRefresh: () => set((s) => ({ viewpointsRefreshNonce: s.viewpointsRefreshNonce + 1 })),

  filters: { minElevationMeters: 0, maxDistanceToRoadMeters: MAX_ROAD_DISTANCE_SLIDER_METERS },
  setMinElevationMeters: (value) => set((s) => ({ filters: { ...s.filters, minElevationMeters: value } })),
  setMaxDistanceToRoadMeters: (value) => set((s) => ({ filters: { ...s.filters, maxDistanceToRoadMeters: value } })),

  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  showPrivateLand: false,
  togglePrivateLand: () => set((s) => ({ showPrivateLand: !s.showPrivateLand })),
  excludedLandAreas: [],
  setExcludedLandAreas: (excludedLandAreas) => set({ excludedLandAreas }),

  locationTracking: false,
  toggleLocationTracking: () =>
    set((s) => ({ locationTracking: !s.locationTracking, locationError: null })),
  userLocation: null,
  locationError: null,
  setLocation: (userLocation) => set({ userLocation, locationError: null }),
  setLocationError: (message) => set({ locationError: message }),

  routeDestination: null,
  route: null,
  routeStatus: 'idle',
  routeError: null,
  // Actually fetching happens in useRoute.ts (keyed on routeDestination +
  // userLocation) - this just records what was asked for, the same
  // separation useViewpointsSync already uses between "what's wanted" and
  // "the effect that fetches it". Also turns location tracking on (a no-op
  // if it's already on) so the user doesn't have to separately find the
  // locate button before directions can work.
  requestRoute: (destination) =>
    set({ locationTracking: true, routeDestination: destination, route: null, routeStatus: 'idle', routeError: null }),
  clearRoute: () => set({ routeDestination: null, route: null, routeStatus: 'idle', routeError: null }),
  setRouteLoading: () => set({ routeStatus: 'loading', routeError: null }),
  setRouteLoaded: (route) => set({ route, routeStatus: 'ready', routeError: null }),
  setRouteError: (message) => set({ routeStatus: 'error', routeError: message }),

  satelliteView: false,
  toggleSatelliteView: () => set((s) => ({ satelliteView: !s.satelliteView }))
}))

export { MAX_ROAD_DISTANCE_SLIDER_METERS }
