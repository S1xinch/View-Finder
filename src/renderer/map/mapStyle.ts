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
const DARK_ROAD_CONTRAST_COLOR = '#aab3bd'

export function boostRoadContrast(map: MapLibreMap, color = ROAD_CONTRAST_COLOR): void {
  const style = map.getStyle()
  if (!style?.layers) return

  for (const layer of style.layers) {
    if (layer.type !== 'line') continue
    if (!('source-layer' in layer) || layer['source-layer'] !== 'transportation') continue

    try {
      map.setPaintProperty(layer.id, 'line-color', color)
      map.setPaintProperty(layer.id, 'line-opacity', 1)
    } catch {
      // A handful of transportation-layer lines (e.g. patterned casings)
      // may not accept a flat line-color - skip those rather than let one
      // failure stop the rest of the pass.
    }
  }
}

// Softer, warmer water/landcover tones closer to Apple Maps' palette than
// the positron style's default near-white land / pale blue-grey water.
// Targets the standard OpenMapTiles "water"/"landcover" source-layers the
// same way boostRoadContrast targets "transportation" - generically, since
// the style JSON isn't directly inspectable from this sandbox.
const WATER_TINT = '#aad9f0'
const LANDCOVER_TINT = '#e4ecdb'

export function applyAppleStyleTweaks(map: MapLibreMap): void {
  const style = map.getStyle()
  if (!style?.layers) return

  for (const layer of style.layers) {
    if (layer.type !== 'fill' || !('source-layer' in layer)) continue

    try {
      if (layer['source-layer'] === 'water') {
        map.setPaintProperty(layer.id, 'fill-color', WATER_TINT)
      } else if (layer['source-layer'] === 'landcover') {
        map.setPaintProperty(layer.id, 'fill-color', LANDCOVER_TINT)
      }
    } catch {
      // Pattern-filled layers may not accept a flat fill-color - skip
      // those rather than let one failure stop the rest of the pass.
    }
  }
}

// OpenFreeMap doesn't publish a dark-themed style alongside "positron" (no
// "dark-matter"-style counterpart to swap the style URL to), and repainting
// the light style we already load avoids a second vector-tile fetch/style
// parse altogether - strictly cheaper than loading a whole second style
// just to get dark colors. The rest of the app's chrome (sidebar, popups,
// controls) already follows prefers-color-scheme via CSS variables in
// global.css; this is the map-canvas equivalent of that, applied/toggled
// from MapView.tsx the same way applyAppleStyleTweaks is for light mode.
const DARK_BACKGROUND = '#15181c'
const DARK_GROUND = '#1b1e22'
// A deliberately more saturated, distinctly blue tone than the near-black
// ground/background - previously too close to DARK_BACKGROUND (#0e1a24 vs
// #15181c) to read as "water" rather than just a slightly different shade
// of near-black.
const DARK_WATER = '#153a5c'
const DARK_BUILDING = '#262a30'
const DARK_LABEL_TEXT = '#d6dade'
const DARK_LABEL_HALO = '#0b0c0e'

export function applyDarkMapTweaks(map: MapLibreMap): void {
  const style = map.getStyle()
  if (!style?.layers) return

  for (const layer of style.layers) {
    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', DARK_BACKGROUND)
        continue
      }
      // GeoJSON-sourced layers (this app's own private-land overlay, route
      // line, etc.) have no "source-layer" - never touch those here, they
      // already carry their own deliberate colors.
      if (!('source-layer' in layer)) continue

      if (layer.type === 'fill' || layer.type === 'fill-extrusion') {
        const sourceLayer = layer['source-layer']
        const property = layer.type === 'fill' ? 'fill-color' : 'fill-extrusion-color'
        if (sourceLayer === 'water') map.setPaintProperty(layer.id, property, DARK_WATER)
        else if (sourceLayer === 'building') map.setPaintProperty(layer.id, property, DARK_BUILDING)
        // Catch-all for every other land fill (landcover, landuse, park,
        // aeroway, cemetery, and anything else OpenMapTiles' schema adds
        // that isn't individually named here) - without a fallback, any
        // source-layer not explicitly listed keeps the light style's
        // original (light/white) color, showing up as a pale, out-of-place
        // patch against the dark basemap. A flat dark ground for all of
        // these, with water/roads/buildings/labels carrying the visual
        // hierarchy, is the same simplification most dark map styles make.
        else map.setPaintProperty(layer.id, property, DARK_GROUND)
      } else if (layer.type === 'symbol') {
        // Label halo flips dark<->light along with the basemap so text
        // stays legible against the new background instead of vanishing
        // (a light halo on a light style, kept as-is on a dark one, would
        // blend straight into the dark ground behind the text).
        map.setPaintProperty(layer.id, 'text-color', DARK_LABEL_TEXT)
        map.setPaintProperty(layer.id, 'text-halo-color', DARK_LABEL_HALO)
      }
    } catch {
      // As elsewhere in this file: a handful of pattern-filled or
      // otherwise non-flat-colored layers may not accept these overrides -
      // skip those rather than let one failure stop the rest of the pass.
    }
  }

  boostRoadContrast(map, DARK_ROAD_CONTRAST_COLOR)
}

export const SATELLITE_LAYER_ID = 'satellite-imagery-layer'
const SATELLITE_SOURCE_ID = 'satellite-imagery'

// Esri's World Imagery basemap - free, no API key or signup, the same
// standard many hobby/open-source map apps reach for when a $0-cost
// satellite layer is needed (fair-use rate limited, not meant for heavy
// production traffic, but fine for this app's scale).
const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Layers this app adds itself on top of the base style - always left alone
// by setSatelliteVisible's generic "hide the base style's ground fills"
// pass below, regardless of which order the various layers got added in.
const CUSTOM_LAYER_IDS = new Set([
  SATELLITE_LAYER_ID,
  'excluded-land-fill',
  'excluded-land-outline',
  'route-casing',
  'route-line',
  'route-walk-line'
])

// Adds the satellite raster as one more layer in the existing vector style
// (hidden by default) rather than swapping styles outright via
// map.setStyle() - a full style swap would tear down and require
// re-adding every GeoJSON source/layer this app owns (private land, route
// line), since those live inside the style itself. A Marker (the pin/GPS
// dot layers) isn't affected either way - it's a plain DOM overlay, not
// part of the style.
export function addSatelliteLayer(map: MapLibreMap): void {
  if (map.getSource(SATELLITE_SOURCE_ID)) return

  map.addSource(SATELLITE_SOURCE_ID, {
    type: 'raster',
    tiles: [SATELLITE_TILE_URL],
    tileSize: 256,
    attribution: 'Imagery © Esri'
  })

  const firstLayerId = map.getStyle()?.layers?.[0]?.id
  map.addLayer(
    { id: SATELLITE_LAYER_ID, type: 'raster', source: SATELLITE_SOURCE_ID, layout: { visibility: 'none' } },
    firstLayerId
  )
}

// Toggling satellite on means showing the raster imagery and hiding the
// base style's own ground-cover fills (and its opaque "background" layer,
// which would otherwise paint straight over the imagery) so the photo
// shows through - roads, borders, and labels stay on top for a standard
// "satellite + labels" hybrid look, the same as Apple/Google Maps' own
// satellite mode.
export function setSatelliteVisible(map: MapLibreMap, visible: boolean): void {
  const style = map.getStyle()
  if (!style?.layers) return

  if (map.getLayer(SATELLITE_LAYER_ID)) {
    map.setLayoutProperty(SATELLITE_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  }

  for (const layer of style.layers) {
    if (CUSTOM_LAYER_IDS.has(layer.id)) continue
    if (layer.type !== 'fill' && layer.type !== 'background') continue

    try {
      map.setLayoutProperty(layer.id, 'visibility', visible ? 'none' : 'visible')
    } catch {
      // Ignore any layer that doesn't accept a visibility override - rare,
      // but shouldn't stop the rest of the pass.
    }
  }
}
