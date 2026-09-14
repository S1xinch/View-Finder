import type { BBox } from '../geo/types'
import { splitBBox } from '../geo/tiling'
import { queryOverpass, type FetchLike } from '../osm/overpassClient'
import { buildViewpointQuery, parseViewpoints } from '../osm/viewpointQueries'
import { buildRoadQuery, parseRoads } from '../osm/roadQueries'
import type { RoadSegment } from '../osm/roadQueries'
import { buildLandUseQuery, parseExcludedLandAreas } from '../osm/landUseQueries'
import type { ExcludedLandArea } from '../osm/landUseQueries'
import type { Viewpoint } from '../osm/types'
import { queryElevations } from '../elevation/elevationClient'
import { buildSampleGrid, findLocalMaxima } from '../elevation/prominence'
import type { PeakCandidate } from '../elevation/types'
import { mergeCandidates } from '../scoring/candidateBuilder'
import { filterExcludedLand } from '../scoring/landUseFilter'
import { scoreCandidates } from '../scoring/coolSpotScore'
import { isReachableByRoad } from '../scoring/roadReachability'
import type { CacheStore } from '../cache/CacheStore'

// OSM tags like tourism=viewpoint, road classes, and land-use boundaries
// all change slowly, so a long TTL keeps repeat pans cheap without the
// data going stale in any way a user would notice.
const OSM_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Elevation is immutable - terrain doesn't change - so this is effectively
// "cache forever" within a single app session.
const ELEVATION_CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000

function bboxKey(prefix: string, bbox: BBox): string {
  const round = (n: number): string => n.toFixed(3)
  return `${prefix}:${round(bbox.west)},${round(bbox.south)},${round(bbox.east)},${round(bbox.north)}`
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export interface CoolSpotOrchestratorDeps {
  fetchImpl: FetchLike
  cache: CacheStore
}

export interface CoolSpotOrchestrator {
  getViewpoints: (bbox: BBox) => Promise<Viewpoint[]>
  getExcludedLand: (bbox: BBox) => Promise<ExcludedLandArea[]>
}

// The full "cool spots to drive to" pipeline: tiled Overpass viewpoint
// fetch + elevation-based computed peaks + roads + land-use exclusions,
// merged/filtered/scored into a ranked result. Platform-agnostic by
// design (no Electron/React/DOM imports, per core/'s own portability
// boundary) - takes its network and caching implementations as
// dependencies rather than owning them, so both the Electron main process
// (net.fetch + a disk-backed cache) and a plain browser build (fetch +
// an in-memory-only cache) can share this exact logic instead of
// duplicating it.
export function createCoolSpotOrchestrator(deps: CoolSpotOrchestratorDeps): CoolSpotOrchestrator {
  const { fetchImpl, cache } = deps

  // Only the most recently requested viewport's viewpoints are ever
  // actually wanted (the renderer already discards stale results
  // client-side). Without this, rapid panning piles up several concurrent
  // multi-tile Overpass queries that all keep running for viewports the
  // user has since left. Aborting the previous one as soon as a new one
  // starts fixes both. Scoped per-orchestrator-instance (a closure
  // variable, not a module-level one) so main and web each get their own
  // independent request lifecycle.
  let currentRequest: AbortController | null = null

  async function fetchTile(tile: BBox, label: string, signal: AbortSignal): Promise<Viewpoint[]> {
    const key = bboxKey('viewpoints', tile)
    const cached = await cache.get<Viewpoint[]>(key)
    if (cached) {
      console.log(`[coolSpotOrchestrator] ${label}: cache hit (${cached.length})`)
      return cached
    }

    console.log(`[coolSpotOrchestrator] ${label}: querying Overpass...`)
    const response = await queryOverpass(buildViewpointQuery(tile), { fetchImpl, signal })
    const viewpoints = parseViewpoints(response)
    console.log(
      `[coolSpotOrchestrator] ${label}: ${response.elements.length} raw element(s), ${viewpoints.length} matched viewpoint(s)`
    )
    await cache.set(key, viewpoints, OSM_CACHE_TTL_MS)
    return viewpoints
  }

  async function getOsmViewpoints(bbox: BBox, signal: AbortSignal): Promise<Viewpoint[]> {
    const tiles = splitBBox(bbox)

    console.log(
      `[coolSpotOrchestrator] getViewpoints bbox=(${bbox.west.toFixed(3)},${bbox.south.toFixed(3)},${bbox.east.toFixed(3)},${bbox.north.toFixed(3)}) -> ${tiles.length} tile(s)`
    )

    // Tiles are fetched in parallel rather than one-at-a-time: a
    // sequential loop with a delay between tiles meant a 4-tile viewport
    // could take several seconds even when Overpass itself responds
    // quickly. A typical viewport only ever produces a handful of tiles
    // (the hard cap in tiling.ts, combined with the caller's zoom gate,
    // keeps this from ever becoming a real burst of concurrent requests).
    const results = await Promise.all(tiles.map((tile, i) => fetchTile(tile, `tile ${i + 1}/${tiles.length}`, signal)))

    const byId = new Map<string, Viewpoint>()
    for (const viewpoints of results) {
      for (const vp of viewpoints) byId.set(vp.id, vp)
    }

    return [...byId.values()]
  }

  // Computes likely scenic high points directly from elevation data, so
  // the app has something to show even where nobody has gotten around to
  // tagging a viewpoint in OSM (common in less-touristy/rural areas - see
  // candidateBuilder for how these get merged with OSM's tagged points).
  // Failures here are non-fatal: elevation is a nice-to-have on top of
  // OSM viewpoints, not a dependency they should be blocked by.
  async function getComputedPeaks(bbox: BBox, signal: AbortSignal): Promise<PeakCandidate[]> {
    const key = bboxKey('computedPeaks', bbox)
    const cached = await cache.get<PeakCandidate[]>(key)
    if (cached) {
      console.log(`[coolSpotOrchestrator] computed peaks: cache hit (${cached.length})`)
      return cached
    }

    try {
      console.log('[coolSpotOrchestrator] sampling elevation grid...')
      const grid = buildSampleGrid(bbox)
      const samples = await queryElevations(grid, { fetchImpl, signal })
      const peaks = findLocalMaxima(samples)
      console.log(`[coolSpotOrchestrator] elevation grid: ${samples.length} sample(s), ${peaks.length} local maxima`)
      await cache.set(key, peaks, ELEVATION_CACHE_TTL_MS)
      return peaks
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[coolSpotOrchestrator] computed peaks failed (continuing with OSM viewpoints only):', error)
      return []
    }
  }

  // Road-reachability and land-use exclusion are both "nice to have, not
  // load-bearing": if either fetch fails, we fall back to not filtering
  // on it at all (see roadReachability.ts / landUseFilter.ts) rather than
  // blocking the whole response on a secondary data source.
  // Tiled to the same fixed grid as viewpoints (see splitBBox) so a small
  // pan reuses roads/land-use tiles it already has instead of re-querying
  // the whole viewport from scratch every time - previously these were
  // single whole-viewport queries keyed by the viewport's own (constantly
  // shifting) bounds, so they never hit cache across pans at all and were
  // a steady, avoidable contributor to Overpass rate-limiting during
  // normal panning.
  async function fetchRoadTile(tile: BBox, label: string, signal: AbortSignal): Promise<RoadSegment[]> {
    const key = bboxKey('roads', tile)
    const cached = await cache.get<RoadSegment[]>(key)
    if (cached) {
      console.log(`[coolSpotOrchestrator] ${label}: cache hit (${cached.length})`)
      return cached
    }

    console.log(`[coolSpotOrchestrator] ${label}: querying Overpass...`)
    const response = await queryOverpass(buildRoadQuery(tile), { fetchImpl, signal })
    const roads = parseRoads(response)
    console.log(`[coolSpotOrchestrator] ${label}: ${roads.length} segment(s)`)
    await cache.set(key, roads, OSM_CACHE_TTL_MS)
    return roads
  }

  async function getRoads(bbox: BBox, signal: AbortSignal): Promise<RoadSegment[]> {
    const tiles = splitBBox(bbox)

    try {
      const results = await Promise.all(
        tiles.map((tile, i) => fetchRoadTile(tile, `roads tile ${i + 1}/${tiles.length}`, signal))
      )
      const byId = new Map<string, RoadSegment>()
      for (const roads of results) {
        for (const road of roads) byId.set(road.id, road)
      }
      return [...byId.values()]
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[coolSpotOrchestrator] road query failed (continuing without road-reachability filtering):', error)
      return []
    }
  }

  async function fetchLandUseTile(tile: BBox, label: string, signal: AbortSignal): Promise<ExcludedLandArea[]> {
    const key = bboxKey('excludedLand', tile)
    const cached = await cache.get<ExcludedLandArea[]>(key)
    if (cached) {
      console.log(`[coolSpotOrchestrator] ${label}: cache hit (${cached.length})`)
      return cached
    }

    console.log(`[coolSpotOrchestrator] ${label}: querying Overpass...`)
    const response = await queryOverpass(buildLandUseQuery(tile), { fetchImpl, signal })
    const areas = parseExcludedLandAreas(response)
    console.log(`[coolSpotOrchestrator] ${label}: ${areas.length} area(s)`)
    await cache.set(key, areas, OSM_CACHE_TTL_MS)
    return areas
  }

  async function getExcludedLandAreas(bbox: BBox, signal: AbortSignal): Promise<ExcludedLandArea[]> {
    const tiles = splitBBox(bbox)

    try {
      const results = await Promise.all(
        tiles.map((tile, i) => fetchLandUseTile(tile, `land-use tile ${i + 1}/${tiles.length}`, signal))
      )
      const byId = new Map<string, ExcludedLandArea>()
      for (const areas of results) {
        for (const area of areas) byId.set(area.id, area)
      }
      return [...byId.values()]
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[coolSpotOrchestrator] land-use query failed (continuing without exclusion filtering):', error)
      return []
    }
  }

  async function getViewpoints(bbox: BBox): Promise<Viewpoint[]> {
    currentRequest?.abort()
    const request = new AbortController()
    currentRequest = request

    // allSettled, not all: getComputedPeaks/getRoads/getExcludedLandAreas
    // are already fail-soft internally (see above), but a genuine
    // OSM/Overpass failure used to reject the whole call via Promise.all
    // even when other sources had *already* succeeded - throwing away a
    // perfectly good result because one independent data source
    // hiccuped.
    const [osmResult, elevationResult, roadsResult, landUseResult] = await Promise.allSettled([
      getOsmViewpoints(bbox, request.signal),
      getComputedPeaks(bbox, request.signal),
      getRoads(bbox, request.signal),
      getExcludedLandAreas(bbox, request.signal)
    ])

    // A supersession-abort on any of them should still propagate so the
    // overall call rejects - the caller's staleness guard already
    // discards a stale rejection silently, so this never produces a
    // visible error, but it does stop us returning a bogus "result" for
    // a viewport the caller has already moved on from.
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
      console.warn('[coolSpotOrchestrator] OSM viewpoints failed:', osmResult.reason)
      if (merged.length === 0) {
        // Nothing useful to show at all - surface the real failure
        // instead of a misleading "no viewpoints in this area" empty
        // state.
        throw osmResult.reason
      }
      console.log(`[coolSpotOrchestrator] continuing with ${merged.length} computed peak(s) only`)
    }

    const landFiltered = filterExcludedLand(merged, excludedAreas)
    const scored = scoreCandidates(landFiltered, roads)
    const ranked = scored
      .filter((candidate) => isReachableByRoad(candidate.distanceToRoadMeters ?? null))
      .sort((a, b) => b.score - a.score)

    console.log(
      `[coolSpotOrchestrator] getViewpoints returning ${ranked.length} (${osmViewpoints.length} OSM, ${merged.length - osmViewpoints.length} computed, ` +
        `${merged.length - landFiltered.length} excluded by land-use, ${landFiltered.length - ranked.length} excluded as unreachable by road)`
    )
    return ranked
  }

  // Exposed separately (rather than folded into getViewpoints' response
  // shape) so callers can show/hide the excluded-land overlay
  // independently of the main viewpoints fetch/cancellation lifecycle -
  // this is opt-in, occasional-use ("show me private land"), not part of
  // the core pan-and-load loop. Hits the same cache getViewpoints already
  // populated for the same bbox, so it's typically instant in practice.
  async function getExcludedLand(bbox: BBox): Promise<ExcludedLandArea[]> {
    const controller = new AbortController()
    return getExcludedLandAreas(bbox, controller.signal)
  }

  return { getViewpoints, getExcludedLand }
}
