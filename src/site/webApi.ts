import { createCoolSpotOrchestrator } from '@core/services/coolSpotOrchestrator'
import { MemoryCacheStore } from '@core/cache/MemoryCacheStore'
import { TieredCacheStore } from '@core/cache/TieredCacheStore'
import { queryRoute } from '@core/routing/osrmClient'
import { IndexedDbCacheStore } from './IndexedDbCacheStore'
import type { AppInfo, LatLng, ViewFinderApi } from '@shared/ipcContract'

// Browser build of the same ViewFinderApi the Electron preload script
// exposes (see src/preload/index.ts) - implemented by running the exact
// same core/ pipeline directly in the page instead of over Electron's
// IPC, using the page's own fetch() instead of Electron's net.fetch.
// Same TieredCacheStore(memory, persistent) pattern
// main/services/coolSpotService.ts uses - IndexedDbCacheStore is this
// build's equivalent of the desktop app's DiskCacheStore, so a repeat
// visit to an already-cached area is an instant local read here too,
// not just within a single page session.
const orchestrator = createCoolSpotOrchestrator({
  fetchImpl: (input, init) => fetch(input, init),
  cache: new TieredCacheStore(new MemoryCacheStore(), new IndexedDbCacheStore())
})

// Only the most recently requested route is ever wanted - same
// supersession behavior as main/services/routeService.ts.
let currentRouteRequest: AbortController | null = null

export const webApi: ViewFinderApi = {
  getAppInfo: async (): Promise<AppInfo> => ({
    name: 'View Finder',
    version: __APP_VERSION__,
    platform: 'web'
  }),
  getViewpoints: orchestrator.getViewpoints,
  getExcludedLand: orchestrator.getExcludedLand,
  getRoute: async (from: LatLng, to: LatLng) => {
    currentRouteRequest?.abort()
    const request = new AbortController()
    currentRouteRequest = request
    return queryRoute(from, to, { fetchImpl: (input, init) => fetch(input, init), signal: request.signal })
  }
}
