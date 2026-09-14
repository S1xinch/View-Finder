// OpenFreeMap (openfreemap.org) — free, no API key, no rate limits, donation-funded
// OSM vector tiles. "positron"-family light/muted base gives the clean, restrained
// look we want instead of a stock OSM raster tile style. Swapping to a self-hosted
// Protomaps extract later only means changing this URL.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

export const DEFAULT_VIEW = {
  // Blue Mountains, NSW — a well-known scenic area west of Sydney with a lot
  // of tourism=viewpoint tagging in OSM, so the app has real markers to show
  // right on open rather than a blank map. Zoom 11 is comfortably above
  // MIN_ZOOM_FOR_VIEWPOINTS so viewpoints load immediately.
  center: [150.3119, -33.7128] as [number, number],
  zoom: 11
}
