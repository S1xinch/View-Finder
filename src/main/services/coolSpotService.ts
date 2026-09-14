import { net } from 'electron'
import type { BBox } from '@core/geo/types'
import { splitBBox } from '@core/geo/tiling'
import { queryOverpass } from '@core/osm/overpassClient'
import { buildViewpointQuery, parseViewpoints } from '@core/osm/viewpointQueries'
import type { Viewpoint } from '@core/osm/types'
import { queryElevations } from '@core/elevation/elevationClient'
import { buildSampleGrid, findLocalMaxima } from '@core/elevation/prominence'
import type { PeakCandidate } from '@core/elevation/types'
import { mergeCandidates } from '@core/scoring/candidateBuilder'
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

// OSM tags like tourism=viewpoint change slowly, so a long TTL keeps repeat
// pans cheap without the data going stale in any way a user would notice.
const VIEWPOINT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

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
  await cache.set(key, viewpoints, VIEWPOINT_CACHE_TTL_MS)
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
    if (error instanceof Error && error.name === 'AbortError') throw error
    console.warn('[coolSpotService] computed peaks failed (continuing with OSM viewpoints only):', error)
    return []
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export async function getViewpoints(bbox: BBox): Promise<Viewpoint[]> {
  currentRequest?.abort()
  const request = new AbortController()
  currentRequest = request

  // allSettled, not all: getComputedPeaks() is already fail-soft internally
  // (see above), but a genuine OSM/Overpass failure used to reject the
  // whole call via Promise.all even when computed peaks had *already*
  // succeeded - throwing away a perfectly good result because a separate,
  // independent data source hiccuped.
  const [osmResult, elevationResult] = await Promise.allSettled([
    getOsmViewpoints(bbox, request.signal),
    getComputedPeaks(bbox, request.signal)
  ])

  // A supersession-abort should still propagate so the overall call
  // rejects - the renderer's staleness guard already discards a stale
  // rejection silently, so this never produces a visible error, but it
  // does stop us returning a bogus "result" for a viewport the caller has
  // already moved on from.
  if (osmResult.status === 'rejected' && isAbortError(osmResult.reason)) throw osmResult.reason
  if (elevationResult.status === 'rejected' && isAbortError(elevationResult.reason)) throw elevationResult.reason

  const osmViewpoints = osmResult.status === 'fulfilled' ? osmResult.value : []
  const computedPeaks = elevationResult.status === 'fulfilled' ? elevationResult.value : []
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

  console.log(
    `[coolSpotService] getViewpoints returning ${merged.length} total (${osmViewpoints.length} OSM + ${merged.length - osmViewpoints.length} computed)`
  )
  return merged
}
