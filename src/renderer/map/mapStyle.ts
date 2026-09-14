import type { Map as MapLibreMap } from 'maplibre-gl'

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

// The positron style's default road rendering (light grey/white, minimal)
// meant minor roads and tracks (e.g. fire trails, common in AU bushland)
// were nearly the same color as the surrounding terrain - you couldn't
// tell whether a viewpoint was actually reachable by road just by looking.
// OpenFreeMap follows the standard OpenMapTiles vector schema, where all
// road/track/path linework lives under the "transportation" source-layer
// regardless of the specific layer id a given style uses for it - so this
// finds those layers generically rather than guessing at exact ids, and
// darkens them for real contrast against the light basemap.
const ROAD_CONTRAST_COLOR = '#4a5157'

export function boostRoadContrast(map: MapLibreMap): void {
  const style = map.getStyle()
  if (!style?.layers) return

  for (const layer of style.layers) {
    if (layer.type !== 'line') continue
    if (!('source-layer' in layer) || layer['source-layer'] !== 'transportation') continue

    try {
      map.setPaintProperty(layer.id, 'line-color', ROAD_CONTRAST_COLOR)
      map.setPaintProperty(layer.id, 'line-opacity', 1)
    } catch {
      // A handful of transportation-layer lines (e.g. patterned casings)
      // may not accept a flat line-color - skip those rather than let one
      // failure stop the rest of the pass.
    }
  }
}
