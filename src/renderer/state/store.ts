import { create } from 'zustand'
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Viewpoint } from '@shared/ipcContract'

export type ViewpointsStatus = 'idle' | 'zoomed-out' | 'loading' | 'error' | 'ready'

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
  setViewpointsError: (message) => set({ viewpointsStatus: 'error', viewpointsError: message })
}))
