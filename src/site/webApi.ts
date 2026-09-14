import { createCoolSpotOrchestrator } from '@core/services/coolSpotOrchestrator'
import { MemoryCacheStore } from '@core/cache/MemoryCacheStore'
import { queryRoute } from '@core/routing/osrmClient'
import type { AppInfo, LatLng, ViewFinderApi } from '@shared/ipcContract'

// Browser build of the same ViewFinderApi the Electron preload script
// exposes (see src/preload/index.ts) - implemented by running the exact
// same core/ pipeline directly in the page instead of over Electron's
// IPC, using the page's own fetch() instead of Electron's net.fetch. No
// persistent disk cache here (a browser tab has no filesystem access) -
// just an in-memory cache for the current session, the same benefit
// MemoryCacheStore already provides Electron for same-session repeat
// pans (see DiskCacheStore for the desktop app's additional
// cross-restart persistence, which has no browser equivalent here yet).
const orchestrator = createCoolSpotOrchestrator({
  fetchImpl: (input, init) => fetch(input, init),
  cache: new MemoryCacheStore()
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
