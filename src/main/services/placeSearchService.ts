import { net } from 'electron'
import { searchPlaces as queryPlaces } from '@core/geocoding/nominatimClient'
import type { PlaceResult } from '@shared/ipcContract'

// Same rationale as coolSpotService.ts/routeService.ts: net.fetch
// (Chromium's network stack) is the one that reliably connects on
// networks where Node's plain fetch has been observed to hang/fail
// outright.
const fetchImpl = net.fetch.bind(net)

// Only the most recently typed search is ever wanted - each keystroke
// (after the renderer's own debounce) should cancel whatever the previous
// one was still waiting on, same supersession pattern as routeService.ts.
let currentRequest: AbortController | null = null

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  currentRequest?.abort()
  const request = new AbortController()
  currentRequest = request

  console.log(`[placeSearchService] searchPlaces query=${JSON.stringify(query)}`)
  const results = await queryPlaces(query, { fetchImpl, signal: request.signal })
  console.log(`[placeSearchService] ${results.length} result(s)`)
  return results
}
