import { net } from 'electron'
import type { LatLng } from '@core/routing/types'
import { queryRoute } from '@core/routing/osrmClient'

// Same rationale as coolSpotService.ts: net.fetch (Chromium's network
// stack) is the one that reliably connects on networks where Node's plain
// fetch has been observed to hang/fail outright.
const fetchImpl = net.fetch.bind(net)

// Only the most recently requested route is ever wanted - a user clicking
// "Directions" on a different spot before the first route finishes loading
// should cancel the stale request rather than let it race the new one.
let currentRequest: AbortController | null = null

export async function getRoute(from: LatLng, to: LatLng) {
  currentRequest?.abort()
  const request = new AbortController()
  currentRequest = request

  console.log(
    `[routeService] getRoute from=(${from.lat.toFixed(4)},${from.lng.toFixed(4)}) to=(${to.lat.toFixed(4)},${to.lng.toFixed(4)})`
  )
  const route = await queryRoute(from, to, { fetchImpl, signal: request.signal })
  console.log(`[routeService] route: ${(route.distanceMeters / 1000).toFixed(1)} km, ${Math.round(route.durationSeconds / 60)} min, ${route.steps.length} step(s)`)
  return route
}
