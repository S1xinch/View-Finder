import { create } from 'zustand'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { ExcludedLandArea, Viewpoint } from '@shared/ipcContract'

export type ViewpointsStatus = 'idle' | 'zoomed-out' | 'loading' | 'error' | 'ready'

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

interface ViewFinderStore {
  map: MapLibreMap | null
  setMap: (map: MapLibreMap | null) => void

  viewpoints: Viewpoint[]
  viewpointsStatus: ViewpointsStatus
  viewpointsError: string | null
  setViewpointsLoading: () => void
  setViewpointsZoomedOut: () => void
  setViewpointsLoaded: (viewpoints: Viewpoint[]) => void
  setViewpointsError: (message: string) => void

  filters: FilterState
  setMinElevationMeters: (value: number) => void
  setMaxDistanceToRoadMeters: (value: number) => void

  listPanelOpen: boolean
  toggleListPanel: () => void

  showPrivateLand: boolean
  togglePrivateLand: () => void
  excludedLandAreas: ExcludedLandArea[]
  setExcludedLandAreas: (areas: ExcludedLandArea[]) => void
}

export const useViewFinderStore = create<ViewFinderStore>((set) => ({
  map: null,
  setMap: (map) => set({ map }),

  viewpoints: [],
  viewpointsStatus: 'idle',
  viewpointsError: null,
  setViewpointsLoading: () => set({ viewpointsStatus: 'loading', viewpointsError: null }),
  setViewpointsZoomedOut: () => set({ viewpoints: [], viewpointsStatus: 'zoomed-out', viewpointsError: null }),
  setViewpointsLoaded: (viewpoints) => set({ viewpoints, viewpointsStatus: 'ready', viewpointsError: null }),
  setViewpointsError: (message) => set({ viewpointsStatus: 'error', viewpointsError: message }),

  filters: { minElevationMeters: 0, maxDistanceToRoadMeters: MAX_ROAD_DISTANCE_SLIDER_METERS },
  setMinElevationMeters: (value) => set((s) => ({ filters: { ...s.filters, minElevationMeters: value } })),
  setMaxDistanceToRoadMeters: (value) => set((s) => ({ filters: { ...s.filters, maxDistanceToRoadMeters: value } })),

  // Open by default: a ranked list nobody notices behind a small pill isn't
  // useful - the whole point of Phase 4 was to produce this list.
  listPanelOpen: true,
  toggleListPanel: () => set((s) => ({ listPanelOpen: !s.listPanelOpen })),

  showPrivateLand: false,
  togglePrivateLand: () => set((s) => ({ showPrivateLand: !s.showPrivateLand })),
  excludedLandAreas: [],
  setExcludedLandAreas: (excludedLandAreas) => set({ excludedLandAreas })
}))

export { MAX_ROAD_DISTANCE_SLIDER_METERS }
