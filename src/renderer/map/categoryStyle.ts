import type { Viewpoint } from '@shared/ipcContract'

export const CATEGORY_LABEL: Record<Viewpoint['category'], string> = {
  viewpoint: 'Viewpoint',
  peak: 'Peak',
  alpine_hut: 'Alpine hut',
  computed_peak: 'Possible peak (estimated)'
}

// Shared with ViewpointLayer.tsx's MapLibre paint expression (which needs
// these as literal values, not CSS custom properties) and Sidebar's
// category dots, so the two never drift apart.
export const CATEGORY_COLOR: Record<Viewpoint['category'], string> = {
  // Matches --vf-accent in global.css - ties the marker palette to the
  // app's own defined brand color instead of a separately-picked blue.
  viewpoint: '#2f6fed',
  // Muted terracotta/rust rather than a stock alert-red.
  peak: '#b3543f',
  // Deeper forest green rather than a generic "success" green.
  alpine_hut: '#3f6b4a',
  // A deeper, more saturated amber - a lighter version plus reduced
  // opacity made these hard to spot against the map's light basemap.
  computed_peak: '#b8860b'
}
