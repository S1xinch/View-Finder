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

// Be polite to the free public Overpass instance when a viewport needed
// multiple tile requests.
const INTER_TILE_DELAY_MS = 300

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bboxKey(prefix: string, bbox: BBox): string {
  const round = (n: number): string => n.toFixed(3)
  return `${prefix}:${round(bbox.west)},${round(bbox.south)},${round(bbox.east)},${round(bbox.north)}`
}

async function getOsmViewpoints(bbox: BBox, signal: AbortSignal): Promise<Viewpoint[]> {
  const tiles = splitBBox(bbox)
  const byId = new Map<string, Viewpoint>()

  console.log(
    `[coolSpotService] getViewpoints bbox=(${bbox.west.toFixed(3)},${bbox.south.toFixed(3)},${bbox.east.toFixed(3)},${bbox.north.toFixed(3)}) -> ${tiles.length} tile(s)`
  )

  for (let i = 0; i < tiles.length; i++) {
    if (signal.aborted) {
      console.log(`[coolSpotService] aborted (superseded by a newer viewport request)`)
      throw new DOMException('Superseded by a newer viewport request', 'AbortError')
    }

    const tile = tiles[i]
    const key = bboxKey('viewpoints', tile)
    let viewpoints = await cache.get<Viewpoint[]>(key)

    if (!viewpoints) {
      console.log(`[coolSpotService] tile ${i + 1}/${tiles.length}: querying Overpass...`)
      const response = await queryOverpass(buildViewpointQuery(tile), { fetchImpl, signal })
      viewpoints = parseViewpoints(response)
      console.log(
        `[coolSpotService] tile ${i + 1}/${tiles.length}: ${response.elements.length} raw element(s), ${viewpoints.length} matched viewpoint(s)`
      )
      await cache.set(key, viewpoints, VIEWPOINT_CACHE_TTL_MS)
      if (i < tiles.length - 1) await delay(INTER_TILE_DELAY_MS)
    } else {
      console.log(`[coolSpotService] tile ${i + 1}/${tiles.length}: cache hit (${viewpoints.length})`)
    }

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

export async function getViewpoints(bbox: BBox): Promise<Viewpoint[]> {
  currentRequest?.abort()
  const request = new AbortController()
  currentRequest = request

  const [osmViewpoints, computedPeaks] = await Promise.all([
    getOsmViewpoints(bbox, request.signal),
    getComputedPeaks(bbox, request.signal)
  ])

  const merged = mergeCandidates(osmViewpoints, computedPeaks)
  console.log(
    `[coolSpotService] getViewpoints returning ${merged.length} total (${osmViewpoints.length} OSM + ${merged.length - osmViewpoints.length} computed)`
  )
  return merged
}
