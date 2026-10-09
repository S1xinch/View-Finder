import type { Viewpoint } from '@shared/ipcContract'

export const CATEGORY_LABEL: Record<Viewpoint['category'], string> = {
  viewpoint: 'Viewpoint',
  peak: 'Peak',
  alpine_hut: 'Alpine hut',
  computed_peak: 'Possible peak (estimated)',
  dropped_pin: 'Dropped pin'
}

export function formatCoordinates(spot: { lat: number; lng: number }): string {
  return `${spot.lat.toFixed(5)}, ${spot.lng.toFixed(5)}`
}
