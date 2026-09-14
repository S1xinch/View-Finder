import type { BBox } from '@core/geo/types'
import { splitBBox } from '@core/geo/tiling'
import { queryOverpass } from '@core/osm/overpassClient'
import { buildViewpointQuery, parseViewpoints } from '@core/osm/viewpointQueries'
import type { Viewpoint } from '@core/osm/types'
import { MemoryCacheStore } from '@core/cache/MemoryCacheStore'
import type { CacheStore } from '@core/cache/CacheStore'

// OSM tags like tourism=viewpoint change slowly, so a long TTL keeps repeat
// pans cheap without the data going stale in any way a user would notice.
const VIEWPOINT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Be polite to the free public Overpass instance when a viewport needed
// multiple tile requests.
const INTER_TILE_DELAY_MS = 300

const cache: CacheStore = new MemoryCacheStore()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tileKey(bbox: BBox): string {
  const round = (n: number): string => n.toFixed(3)
  return `viewpoints:${round(bbox.west)},${round(bbox.south)},${round(bbox.east)},${round(bbox.north)}`
}

export async function getViewpoints(bbox: BBox): Promise<Viewpoint[]> {
  const tiles = splitBBox(bbox)
  const byId = new Map<string, Viewpoint>()

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    const key = tileKey(tile)
    let viewpoints = await cache.get<Viewpoint[]>(key)

    if (!viewpoints) {
      const response = await queryOverpass(buildViewpointQuery(tile))
      viewpoints = parseViewpoints(response)
      await cache.set(key, viewpoints, VIEWPOINT_CACHE_TTL_MS)
      if (i < tiles.length - 1) await delay(INTER_TILE_DELAY_MS)
    }

    for (const vp of viewpoints) byId.set(vp.id, vp)
  }

  return [...byId.values()]
}
