import { create } from 'zustand'
import type { Map as MapLibreMap } from 'maplibre-gl'

interface ViewFinderStore {
  map: MapLibreMap | null
  setMap: (map: MapLibreMap | null) => void
}

export const useViewFinderStore = create<ViewFinderStore>((set) => ({
  map: null,
  setMap: (map) => set({ map })
}))
