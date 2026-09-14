// OpenFreeMap (openfreemap.org) — free, no API key, no rate limits, donation-funded
// OSM vector tiles. "positron"-family light/muted base gives the clean, restrained
// look we want instead of a stock OSM raster tile style. Swapping to a self-hosted
// Protomaps extract later only means changing this URL.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

export const DEFAULT_VIEW = {
  center: [-98.5795, 39.8283] as [number, number], // continental US center, arbitrary start
  zoom: 4
}
