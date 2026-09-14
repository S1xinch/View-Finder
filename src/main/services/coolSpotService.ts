import { net } from 'electron'
import type { BBox } from '@core/geo/types'
import { splitBBox } from '@core/geo/tiling'
import { queryOverpass } from '@core/osm/overpassClient'
import { buildViewpointQuery, parseViewpoints } from '@core/osm/viewpointQueries'
import { buildRoadQuery, parseRoads } from '@core/osm/roadQueries'
import type { RoadSegment } from '@core/osm/roadQueries'
import { buildLandUseQuery, parseExcludedLandAreas } from '@core/osm/landUseQueries'
import type { ExcludedLandArea } from '@core/osm/landUseQueries'
import type { Viewpoint } from '@core/osm/types'
import { queryElevations } from '@core/elevation/elevationClient'
import { buildSampleGrid, findLocalMaxima } from '@core/elevation/prominence'
import type { PeakCandidate } from '@core/elevation/types'
import { mergeCandidates } from '@core/scoring/candidateBuilder'
import { filterExcludedLand } from '@core/scoring/landUseFilter'
import { scoreCandidates } from '@core/scoring/coolSpotScore'
import { isReachableByRoad } from '@core/scoring/roadReachability'
import { MemoryCacheStore } from '@core/cache/MemoryCacheStore'
import type { CacheStore } from '@core/cache/CacheStore'

// Confirmed by a real ConnectTimeoutError from a user's machine: Node's
// plain fetch (undici) genuinely cannot reach overpass-api.de directly on
// some networks/VPNs, while net.fetch (Chromium's network stack, same path
// the renderer's already-working map tile requests use) does connect. So
// net.fetch is needed for connectivity; the Accept/User-Agent headers in
// overpassClient.ts are needed on top of that to avoid a 406 from
// Overpass's front end, which net.fetch's browser-style request triggered
// without them.
const fetchImpl = net.fetch.bind(net)

// OSM tags like tourism=viewpoint, road classes, and land-use boundaries
// all change slowly, so a long TTL keeps repeat pans cheap without the
// data going stale in any way a user would notice.
const OSM_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Elevation is immutable - terrain doesn't change - so this is effectively
// "cache forever" within a single app session.
const ELEVATION_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000

const cache: CacheStore = new MemoryCacheStore()

// Only the most recently requested viewport's viewpoints are ever actually
// wanted (the renderer already discards stale results client-side - see
// useViewpointsSync). Without this, rapid panning piles up several
// concurrent multi-tile Overpass queries that all keep running for
// viewports the user has since left, burning through the free public
// instance's rate limit and slowing down the request that actually
// matters. Aborting the previous one as soon as a new one starts fixes
// both.
let currentRequest: AbortController | null = null

function bboxKey(prefix: string, bbox: BBox): string {
  const round = (n: number): string => n.toFixed(3)
  return `${prefix}:${round(bbox.west)},${round(bbox.south)},${round(bbox.east)},${round(bbox.north)}`
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function fetchTile(tile: BBox, label: string, signal: AbortSignal): Promise<Viewpoint[]> {
  const key = bboxKey('viewpoints', tile)
  const cached = await cache.get<Viewpoint[]>(key)
  if (cached) {
    console.log(`[coolSpotService] ${label}: cache hit (${cached.length})`)
    return cached
  }

  console.log(`[coolSpotService] ${label}: querying Overpass...`)
  const response = await queryOverpass(buildViewpointQuery(tile), { fetchImpl, signal })
  const viewpoints = parseViewpoints(response)
  console.log(`[coolSpotService] ${label}: ${response.elements.length} raw element(s), ${viewpoints.length} matched viewpoint(s)`)
  await cache.set(key, viewpoints, OSM_CACHE_TTL_MS)
  return viewpoints
}

async function getOsmViewpoints(bbox: BBox, signal: AbortSignal): Promise<Viewpoint[]> {
  const tiles = splitBBox(bbox)

  console.log(
    `[coolSpotService] getViewpoints bbox=(${bbox.west.toFixed(3)},${bbox.south.toFixed(3)},${bbox.east.toFixed(3)},${bbox.north.toFixed(3)}) -> ${tiles.length} tile(s)`
  )

  // Tiles are fetched in parallel rather than one-at-a-time: a sequential
  // loop with a delay between tiles meant a 4-tile viewport could take
  // several seconds even when Overpass itself responds quickly. A typical
  // viewport only ever produces a handful of tiles (the hard cap in
  // tiling.ts, combined with the renderer's zoom gate, keeps this from
  // ever becoming a real burst of concurrent requests).
  const results = await Promise.all(
    tiles.map((tile, i) => fetchTile(tile, `tile ${i + 1}/${tiles.length}`, signal))
  )

  const byId = new Map<string, Viewpoint>()
  for (const viewpoints of results) {
    for (const vp of viewpoints) byId.set(vp.id, vp)
  }

  return [...byId.values()]
}

// Computes likely scenic high points directly from elevation data, so the
// app has something to show even where nobody has gotten around to tagging
// a viewpoint in OSM (common in less-touristy/rural areas - see
// candidateBuilder for how these get merged with OSM's tagged points).
// Failures here are non-fatal: elevation is a nice-to-have on top of OSM
// viewpoints, not a dependency they should be blocked by.
async function getComputedPeaks(bbox: BBox, signal: AbortSignal): Promise<PeakCandidate[]> {
  const key = bboxKey('computedPeaks', bbox)
  const cached = await cache.get<PeakCandidate[]>(key)
  if (cached) {
    console.log(`[coolSpotService] computed peaks: cache hit (${cached.length})`)
    return cached
  }

  try {
    console.log('[coolSpotService] sampling elevation grid...')
    const grid = buildSampleGrid(bbox)
    const samples = await queryElevations(grid, { fetchImpl, signal })
    const peaks = findLocalMaxima(samples)
    console.log(`[coolSpotService] elevation grid: ${samples.length} sample(s), ${peaks.length} local maxima`)
    await cache.set(key, peaks, ELEVATION_CACHE_TTL_MS)
    return peaks
  } catch (error) {
    if (isAbortError(error)) throw error
    console.warn('[coolSpotService] computed peaks failed (continuing with OSM viewpoints only):', error)
    return []
  }
}

// Road-reachability and land-use exclusion are both "nice to have, not
// load-bearing": if either fetch fails, we fall back to not filtering on
// it at all (see roadReachability.ts / landUseFilter.ts) rather than
// blocking the whole response on a secondary data source.
async function getRoads(bbox: BBox, signal: AbortSignal): Promise<RoadSegment[]> {
  const key = bboxKey('roads', bbox)
  const cached = await cache.get<RoadSegment[]>(key)
  if (cached) {
    console.log(`[coolSpotService] roads: cache hit (${cached.length})`)
    return cached
  }

  try {
    console.log('[coolSpotService] querying roads...')
    const response = await queryOverpass(buildRoadQuery(bbox), { fetchImpl, signal })
    const roads = parseRoads(response)
    console.log(`[coolSpotService] roads: ${roads.length} segment(s)`)
    await cache.set(key, roads, OSM_CACHE_TTL_MS)
    return roads
  } catch (error) {
    if (isAbortError(error)) throw error
    console.warn('[coolSpotService] road query failed (continuing without road-reachability filtering):', error)
    return []
  }
}

async function getExcludedLandAreas(bbox: BBox, signal: AbortSignal): Promise<ExcludedLandArea[]> {
  const key = bboxKey('excludedLand', bbox)
  const cached = await cache.get<ExcludedLandArea[]>(key)
  if (cached) {
    console.log(`[coolSpotService] excluded land: cache hit (${cached.length})`)
    return cached
  }

  try {
    console.log('[coolSpotService] querying land-use exclusions...')
    const response = await queryOverpass(buildLandUseQuery(bbox), { fetchImpl, signal })
    const areas = parseExcludedLandAreas(response)
    console.log(`[coolSpotService] excluded land: ${areas.length} area(s)`)
    await cache.set(key, areas, OSM_CACHE_TTL_MS)
    return areas
  } catch (error) {
    if (isAbortError(error)) throw error
    console.warn('[coolSpotService] land-use query failed (continuing without exclusion filtering):', error)
    return []
  }
}

export async function getViewpoints(bbox: BBox): Promise<Viewpoint[]> {
  currentRequest?.abort()
  const request = new AbortController()
  currentRequest = request

  // allSettled, not all: getComputedPeaks/getRoads/getExcludedLandAreas are
  // already fail-soft internally (see above), but a genuine OSM/Overpass
  // failure used to reject the whole call via Promise.all even when other
  // sources had *already* succeeded - throwing away a perfectly good
  // result because one independent data source hiccuped.
  const [osmResult, elevationResult, roadsResult, landUseResult] = await Promise.allSettled([
    getOsmViewpoints(bbox, request.signal),
    getComputedPeaks(bbox, request.signal),
    getRoads(bbox, request.signal),
    getExcludedLandAreas(bbox, request.signal)
  ])

  // A supersession-abort on any of them should still propagate so the
  // overall call rejects - the renderer's staleness guard already discards
  // a stale rejection silently, so this never produces a visible error,
  // but it does stop us returning a bogus "result" for a viewport the
  // caller has already moved on from.
  if (osmResult.status === 'rejected' && isAbortError(osmResult.reason)) throw osmResult.reason
  if (elevationResult.status === 'rejected' && isAbortError(elevationResult.reason)) throw elevationResult.reason
  if (roadsResult.status === 'rejected' && isAbortError(roadsResult.reason)) throw roadsResult.reason
  if (landUseResult.status === 'rejected' && isAbortError(landUseResult.reason)) throw landUseResult.reason

  const osmViewpoints = osmResult.status === 'fulfilled' ? osmResult.value : []
  const computedPeaks = elevationResult.status === 'fulfilled' ? elevationResult.value : []
  const roads = roadsResult.status === 'fulfilled' ? roadsResult.value : []
  const excludedAreas = landUseResult.status === 'fulfilled' ? landUseResult.value : []

  const merged = mergeCandidates(osmViewpoints, computedPeaks)

  if (osmResult.status === 'rejected') {
    console.warn('[coolSpotService] OSM viewpoints failed:', osmResult.reason)
    if (merged.length === 0) {
      // Nothing useful to show at all - surface the real failure instead
      // of a misleading "no viewpoints in this area" empty state.
      throw osmResult.reason
    }
    console.log(`[coolSpotService] continuing with ${merged.length} computed peak(s) only`)
  }

  const landFiltered = filterExcludedLand(merged, excludedAreas)
  const scored = scoreCandidates(landFiltered, roads)
  const ranked = scored
    .filter((candidate) => isReachableByRoad(candidate.distanceToRoadMeters ?? null))
    .sort((a, b) => b.score - a.score)

  console.log(
    `[coolSpotService] getViewpoints returning ${ranked.length} (${osmViewpoints.length} OSM, ${merged.length - osmViewpoints.length} computed, ` +
      `${merged.length - landFiltered.length} excluded by land-use, ${landFiltered.length - ranked.length} excluded as unreachable by road)`
  )
  return ranked
}
