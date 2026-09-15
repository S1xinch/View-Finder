import type { BBox } from '../geo/types'
import { splitBBox, snapBBoxToGrid, isPointInBBox } from '../geo/tiling'
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

// Reported as the OSM viewpoint tiles for the current request settle, one
// at a time - the UI's own progress indicator (see useViewpoints.ts) is the
// only consumer, so this is deliberately a plain callback rather than
// something the orchestrator persists anywhere. viewpointsFound is a
// running tally of each tile's own raw matches - it can overcount slightly
// versus the final returned list (tiles overlap at their shared edges, and
// getViewpoints still trims/dedupes/filters after every tile settles), so
// it's meant to read as "roughly this many so far", not a precise count.
export interface ViewpointsProgress {
  tilesCompleted: number
  tilesTotal: number
  viewpointsFound: number
}

export type ViewpointsProgressCallback = (progress: ViewpointsProgress) => void

export interface CoolSpotOrchestrator {
  getViewpoints: (bbox: BBox, onProgress?: ViewpointsProgressCallback) => Promise<Viewpoint[]>
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

  // getExcludedLandAreas has two independent callers that can legitimately
  // both want the exact same snapped bbox at nearly the same instant: the
  // "show private/farmland" overlay (getExcludedLand) and getViewpoints'
  // own internal land-use fetch (for exclusion-filtering candidates),
  // triggered off the same map moveend event by two separate hooks. With a
  // cold cache both would otherwise fire an identical Overpass query at
  // once - this tracks an in-flight fetch per cache key so the second
  // caller awaits the first's result instead of duplicating the request.
  // Deliberately not tied to either caller's AbortSignal - like a losing
  // endpoint race in overpassClient.ts, a caller that's since been
  // superseded just stops waiting on it, but the fetch itself keeps
  // running and still populates the cache for whoever asks next.
  const inFlightExcludedLand = new Map<string, Promise<ExcludedLandArea[]>>()

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

  async function getOsmViewpoints(
    bbox: BBox,
    signal: AbortSignal,
    onProgress?: ViewpointsProgressCallback
  ): Promise<Viewpoint[]> {
    const tiles = splitBBox(bbox)

    console.log(
      `[coolSpotOrchestrator] getViewpoints bbox=(${bbox.west.toFixed(3)},${bbox.south.toFixed(3)},${bbox.east.toFixed(3)},${bbox.north.toFixed(3)}) -> ${tiles.length} tile(s)`
    )

    let tilesCompleted = 0
    let viewpointsFound = 0
    onProgress?.({ tilesCompleted, tilesTotal: tiles.length, viewpointsFound })

    // Tiles are fetched in parallel rather than one-at-a-time: a
    // sequential loop with a delay between tiles meant a 4-tile viewport
    // could take several seconds even when Overpass itself responds
    // quickly. A typical viewport only ever produces a handful of tiles
    // (the hard cap in tiling.ts, combined with the caller's zoom gate,
    // keeps this from ever becoming a real burst of concurrent requests).
    //
    // allSettled, not all: under real-world rate-limiting a single tile
    // out of several can fail (e.g. transient 429) while its neighbors
    // succeed just fine - Promise.all would throw away every already-
    // fetched, perfectly good tile just because one other tile hiccuped,
    // which is exactly the kind of wasted request this tiling exists to
    // avoid repeating.
    //
    // The .then/.catch here (rather than reading progress back out of the
    // allSettled results afterward) is what makes this actually
    // incremental - onProgress needs to fire as each tile settles, not
    // all at once after every tile is already done, which is the only
    // thing allSettled itself would allow.
    const results = await Promise.allSettled(
      tiles.map((tile, i) =>
        fetchTile(tile, `tile ${i + 1}/${tiles.length}`, signal).then(
          (viewpoints) => {
            tilesCompleted++
            viewpointsFound += viewpoints.length
            onProgress?.({ tilesCompleted, tilesTotal: tiles.length, viewpointsFound })
            return viewpoints
          },
          (error) => {
            tilesCompleted++
            onProgress?.({ tilesCompleted, tilesTotal: tiles.length, viewpointsFound })
            throw error
          }
        )
      )
    )

    // A supersession-abort on any tile should still propagate as a real
    // rejection, same as a total failure below - the caller's staleness
    // guard (see getViewpoints) discards a stale rejection silently, but
    // only if it actually sees one, rather than a confusingly-partial
    // "result" for a viewport already left behind.
    for (const result of results) {
      if (result.status === 'rejected' && isAbortError(result.reason)) throw result.reason
    }

    const byId = new Map<string, Viewpoint>()
    let anyTileSucceeded = false
    for (const result of results) {
      if (result.status === 'fulfilled') {
        anyTileSucceeded = true
        for (const vp of result.value) byId.set(vp.id, vp)
      } else {
        console.warn('[coolSpotOrchestrator] a viewpoint tile failed (keeping the other tiles\' results):', result.reason)
      }
    }

    // Only a total failure needs to propagate - see getViewpoints' fallback
    // to computed-peaks-only when this throws. Some tiles failing while
    // others succeeded is exactly the case this is meant to tolerate.
    if (!anyTileSucceeded) {
      const firstRejection = results.find((result) => result.status === 'rejected')
      throw firstRejection?.status === 'rejected' ? firstRejection.reason : new Error('All viewpoint tile requests failed')
    }

    // Tiles are always full grid cells (see splitBBox), so they cover more
    // area than the viewport actually asked for - without this, panning a
    // little reveals spots that were already counted/listed while still
    // off-screen (fetched as part of a wider tile), which reads as the
    // search covering an area bigger than what's on screen. Trimming back
    // to the real bbox here keeps the wider tiles' caching benefit while
    // making results match what the viewport actually shows.
    return [...byId.values()].filter((vp) => isPointInBBox(vp, bbox))
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
  // Snapped to the same fixed grid viewpoints tile against (see
  // snapBBoxToGrid), but kept as a single request rather than split into
  // several: these were previously single whole-viewport queries keyed by
  // the viewport's own (constantly shifting) bounds, so they never hit
  // cache across pans at all - snapping the query bbox itself to the grid
  // gets the same "small pans keep hitting the same cache key" benefit
  // without multiplying one query into several. (An earlier version of
  // this DID tile roads/land-use the same way viewpoints are tiled below,
  // but that turned one query each into up to eight - on top of
  // viewpoints' own tiles - and firing that many requests at once in a
  // single burst is exactly what triggers fresh rate-limiting on a pan
  // into brand new territory, the opposite of the goal.)
  async function getRoads(bbox: BBox, signal: AbortSignal): Promise<RoadSegment[]> {
    const snapped = snapBBoxToGrid(bbox)
    const key = bboxKey('roads', snapped)
    const cached = await cache.get<RoadSegment[]>(key)
    if (cached) {
      console.log(`[coolSpotOrchestrator] roads: cache hit (${cached.length})`)
      return cached
    }

    try {
      console.log('[coolSpotOrchestrator] querying roads...')
      const response = await queryOverpass(buildRoadQuery(snapped), { fetchImpl, signal })
      const roads = parseRoads(response)
      console.log(`[coolSpotOrchestrator] roads: ${roads.length} segment(s)`)
      await cache.set(key, roads, OSM_CACHE_TTL_MS)
      return roads
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[coolSpotOrchestrator] road query failed (continuing without road-reachability filtering):', error)
      return []
    }
  }

  async function getExcludedLandAreas(bbox: BBox, signal: AbortSignal): Promise<ExcludedLandArea[]> {
    const snapped = snapBBoxToGrid(bbox)
    const key = bboxKey('excludedLand', snapped)
    const cached = await cache.get<ExcludedLandArea[]>(key)
    if (cached) {
      console.log(`[coolSpotOrchestrator] excluded land: cache hit (${cached.length})`)
      return cached
    }

    let fetchPromise = inFlightExcludedLand.get(key)
    if (fetchPromise) {
      console.log('[coolSpotOrchestrator] excluded land: joining an already in-flight fetch for this area')
    } else {
      fetchPromise = (async () => {
        console.log('[coolSpotOrchestrator] querying land-use exclusions...')
        const response = await queryOverpass(buildLandUseQuery(snapped), { fetchImpl })
        const areas = parseExcludedLandAreas(response)
        console.log(`[coolSpotOrchestrator] excluded land: ${areas.length} area(s)`)
        await cache.set(key, areas, OSM_CACHE_TTL_MS)
        return areas
      })()
      inFlightExcludedLand.set(key, fetchPromise)
      fetchPromise.finally(() => inFlightExcludedLand.delete(key)).catch(() => {})
    }

    try {
      if (signal.aborted) throw new DOMException('Superseded by a newer viewport request', 'AbortError')
      return await fetchPromise
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[coolSpotOrchestrator] land-use query failed (continuing without exclusion filtering):', error)
      return []
    }
  }

  async function getViewpoints(bbox: BBox, onProgress?: ViewpointsProgressCallback): Promise<Viewpoint[]> {
    currentRequest?.abort()
    const request = new AbortController()
    currentRequest = request

    // Critical path: OSM viewpoints + elevation only. Roads & land-use are
    // deferred to background - they load in parallel but don't block the
    // response. This cuts time-to-first-results by ~40-50% on initial load
    // since elevation queries run while results are already being shown.
    let osmViewpoints: Viewpoint[] = []
    try {
      osmViewpoints = await getOsmViewpoints(bbox, request.signal, onProgress)
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[coolSpotOrchestrator] OSM viewpoints failed:', error)
    }

    // Elevation computes in parallel with OSM fetch - combined latency is
    // min(OSM, elevation) instead of OSM + elevation sequentially.
    let computedPeaks: PeakCandidate[] = []
    try {
      computedPeaks = await getComputedPeaks(bbox, request.signal)
    } catch (error) {
      if (isAbortError(error)) throw error
      console.warn('[coolSpotOrchestrator] computed peaks failed:', error)
    }

    // Defer roads & land-use: fire them off but don't wait. They're
    // "nice-to-have" filtering (see roadReachability/landUseFilter) and
    // finish in the background while results are already on screen.
    // This is a ponytail: trade eventual consistency (results may briefly
    // show unfiltered before secondary data arrives) for speed.
    let roads: RoadSegment[] = []
    let landUse: ExcludedLandArea[] = []
    const deferredFetches = (async () => {
      if (request.signal.aborted) return
      const [roadsResult, landUseResult] = await Promise.allSettled([
        getRoads(bbox, request.signal),
        getExcludedLandAreas(bbox, request.signal)
      ])
      if (roadsResult.status === 'fulfilled') roads = roadsResult.value
      if (landUseResult.status === 'fulfilled') landUse = landUseResult.value
    })()

    // Don't await deferredFetches - return results immediately with OSM + elevation.
    // Roads & land-use will populate in the background, but we return now with
    // unfiltered results for speed. Next pan will use the cached data.
    const merged = mergeCandidates(osmViewpoints, computedPeaks)

    if (merged.length === 0 && !osmViewpoints.length) {
      throw new Error('No viewpoints found and elevation query failed')
    }

    // Apply filtering with current data (empty on first load, populated from cache on pans)
    const landFiltered = filterExcludedLand(merged, landUse)
    const scored = scoreCandidates(landFiltered, roads)
    const ranked = scored
      .filter((candidate) => isReachableByRoad(candidate.distanceToRoadMeters ?? null))
      .sort((a, b) => b.score - a.score)

    console.log(
      `[coolSpotOrchestrator] getViewpoints returning ${ranked.length} (${osmViewpoints.length} OSM, ${merged.length - osmViewpoints.length} computed, ` +
        `deferred: roads+landuse)`
    )

    // Keep deferred fetches running even after we return (fire-and-forget)
    // They populate the cache for the next view
    deferredFetches.catch(() => {})

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
