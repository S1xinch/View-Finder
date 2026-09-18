import { describe, expect, it, vi } from 'vitest'
import { createCoolSpotOrchestrator } from './coolSpotOrchestrator'
import { MemoryCacheStore } from '../cache/MemoryCacheStore'
import type { BBox } from '../geo/types'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

// A snapped-to-grid bbox smaller than one tile, so it doesn't get split by
// splitBBox - keeps these tests focused on getExcludedLand alone rather
// than also exercising viewpoint tiling.
const bbox: BBox = { west: 0.05, south: 0.05, east: 0.1, north: 0.1 }

// Every logical Overpass query races 2 endpoints in parallel (see
// overpassClient.ts) - "one query" means 2 fetchImpl calls, not 1.
const FETCH_CALLS_PER_QUERY = 2

describe('getExcludedLand', () => {
  it('fetches once and caches the result for a repeat call with the same (snapped) bbox', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }))
    const orchestrator = createCoolSpotOrchestrator({ fetchImpl, cache: new MemoryCacheStore() })

    await orchestrator.getExcludedLand(bbox)
    await orchestrator.getExcludedLand(bbox)

    expect(fetchImpl).toHaveBeenCalledTimes(FETCH_CALLS_PER_QUERY)
  })

  it('joins an already in-flight fetch instead of firing a duplicate request for the same area', async () => {
    // Simulates the real race this fixes: the "show private/farmland"
    // overlay and getViewpoints' own internal land-use fetch can both ask
    // for the same snapped bbox at nearly the same instant with a cold
    // cache - without de-duping, that used to mean two identical Overpass
    // queries (4 fetchImpl calls) for the exact same data instead of one
    // (2 fetchImpl calls, one per raced endpoint).
    const resolvers: ((response: Response) => void)[] = []
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        })
    )
    const orchestrator = createCoolSpotOrchestrator({ fetchImpl, cache: new MemoryCacheStore() })

    const first = orchestrator.getExcludedLand(bbox)
    const second = orchestrator.getExcludedLand(bbox)

    // Both calls' own `await cache.get(...)` (and the second call's join
    // onto the first's in-flight fetch) need a couple of microtask turns
    // to actually run before fetchImpl gets called - resolving
    // immediately/synchronously here would resolve nothing yet.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(FETCH_CALLS_PER_QUERY))
    resolvers[0](jsonResponse({ elements: [] }))

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(fetchImpl).toHaveBeenCalledTimes(FETCH_CALLS_PER_QUERY)
    expect(firstResult).toEqual(secondResult)
  })
})

describe('getViewpoints progress reporting', () => {
  it('reports tile completion and a running viewpoint count as tiles settle', async () => {
    // Wide enough (0.5 degrees) to split into 2 tiles at the fixed
    // 0.25-degree grid (see tiling.ts) - a single-tile bbox would only
    // ever produce one 0/1 -> 1/1 progress tick, which wouldn't actually
    // exercise the "as tiles complete" incremental behavior.
    const wideBbox: BBox = { west: 0, south: 0, east: 0.5, north: 0.25 }
    const viewpointElement = (id: number, lon: number) => ({
      type: 'node',
      id,
      lat: 0.1,
      lon,
      tags: { tourism: 'viewpoint' }
    })

    // mockImplementation (not mockResolvedValue) so every one of the 4
    // fetchImpl calls (2 tiles x 2 raced endpoints each) gets its own
    // fresh Response - a shared instance's body can only be read once,
    // and every one of these calls independently calls response.json().
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ elements: [viewpointElement(1, 0.1), viewpointElement(2, 0.1)] }))
    const orchestrator = createCoolSpotOrchestrator({ fetchImpl, cache: new MemoryCacheStore() })

    const progressUpdates: { tilesCompleted: number; tilesTotal: number; viewpointsFound: number }[] = []
    await orchestrator.getViewpoints(wideBbox, (progress) => progressUpdates.push(progress))

    // The very first update (before any tile has settled) establishes the
    // total up front, so the UI has something to show immediately rather
    // than waiting for the first tile to finish.
    expect(progressUpdates[0]).toEqual({ tilesCompleted: 0, tilesTotal: 2, viewpointsFound: 0 })

    const last = progressUpdates[progressUpdates.length - 1]
    expect(last.tilesCompleted).toBe(2)
    expect(last.tilesTotal).toBe(2)
    // Each tile's node matches tourism=viewpoint - both tiles' raw parses
    // contribute to the running tally this asserts against.
    expect(last.viewpointsFound).toBeGreaterThan(0)
  })
})

describe('getViewpoints road-distance scoring', () => {
  it('threads real road data into distanceToRoadMeters instead of scoring against an empty roads list', async () => {
    // Regression test for a real bug: roads were fetched via a deferred,
    // fire-and-forget promise, then read synchronously (still empty) by
    // scoreCandidates() before that promise ever resolved - so every
    // viewpoint always reported "distance to road unknown", not just on a
    // cold cache. This asserts the fetched road segment actually reaches
    // distanceToRoadMeters, which fails again if that regresses.
    const smallBbox: BBox = { west: 0, south: 0, east: 0.1, north: 0.1 }
    const viewpointElement = { type: 'node', id: 1, lat: 0.05, lon: 0.05, tags: { tourism: 'viewpoint' } }
    // Runs right past the viewpoint, so distanceToRoadMeters should come
    // back small once roads are actually threaded into scoring - not just
    // non-null from any old road far away.
    const roadElement = {
      type: 'way',
      id: 2,
      tags: { highway: 'residential' },
      geometry: [
        { lat: 0.05, lon: 0.049 },
        { lat: 0.05, lon: 0.051 }
      ]
    }

    // Only the road query's body contains "highway" (see buildRoadQuery) -
    // every other query this exercises (viewpoints, land-use, and the NSW
    // tenure GET, which has no body at all) falls through to the
    // viewpoint element, which parses to an empty result for those non-node
    // consumers without erroring.
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: { body?: string }) => {
      const isRoadQuery = init?.body?.includes('highway') ?? false
      return jsonResponse({ elements: [isRoadQuery ? roadElement : viewpointElement] })
    })

    const orchestrator = createCoolSpotOrchestrator({ fetchImpl, cache: new MemoryCacheStore() })
    const results = await orchestrator.getViewpoints(smallBbox, () => {})

    expect(results).toHaveLength(1)
    expect(results[0].distanceToRoadMeters).not.toBeNull()
    expect(results[0].distanceToRoadMeters).toBeLessThan(500)
  })
})
