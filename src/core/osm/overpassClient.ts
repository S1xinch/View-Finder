// Free, no-API-key OSM data via the public Overpass API. The endpoint is a
// parameter (not hardcoded) so a mirror or self-hosted instance can be
// swapped in later without touching any caller.
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

export interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  tags?: Record<string, string>
}

export interface OverpassResponse {
  elements: OverpassElement[]
}

export async function queryOverpass(
  query: string,
  endpoint: string = DEFAULT_OVERPASS_ENDPOINT
): Promise<OverpassResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: query
  })

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as OverpassResponse
}
