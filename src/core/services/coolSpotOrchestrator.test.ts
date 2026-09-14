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
