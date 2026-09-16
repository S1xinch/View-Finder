import type { LatLng } from '../elevation/types'

// Free, no-API-key land tenure lookups via the NSW Government's public
// Land Tenure raster service - classifies any point in NSW into one of
// seven tenure categories (Private, Crown, National Park, etc), sourced
// from Spatial Services/DPIRD and updated "as needed". See
// core/scoring/landUseFilter.ts's filterExcludedTenure for how this gets
// used to keep genuinely private-land peaks out of results. NSW-only -
// a point outside NSW just comes back with no classification (null).
//
// This is a raster layer (a classified image, not vector polygons), and
// its map service only declares Map+Query capabilities - a bulk "give me
// every private-land polygon in this bbox" query isn't available the way
// it is for OSM's land-use tags (see osm/landUseQueries.ts). identify is
// the one operation that works: one point in, one classification out.
export const DEFAULT_NSW_TENURE_ENDPOINT =
  'https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Tenure/Land_Tenure_NSW/MapServer/identify'

const REQUEST_TIMEOUT_MS = 10_000

// identify requires a mapExtent bounding box around the query point - its
// exact size doesn't matter for a single-point lookup, it just needs to
// comfortably contain the point at a sane display resolution.
const IDENTIFY_BUFFER_DEG = 0.01

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type NswTenureClass =
  | 'Crownland-Leasehold'
  | 'Crownland-Other'
  | 'Indigenous Owned'
  | 'National Park'
  | 'Private'
  | 'State Forest'
  | 'Unresolved Tenure'

interface IdentifyResponse {
  results?: Array<{ attributes?: Record<string, string> }>
}

export interface QueryTenureOptions {
  endpoint?: string
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

// Returns null for a point with no classification (ocean, outside NSW) -
// a normal, non-error outcome, distinct from a thrown request failure
// (network error, bad response). Callers should treat both the same way
// for exclusion purposes (don't exclude), but distinguishing them lets a
// caller log a genuine failure differently from "nothing to find here".
export async function queryTenureClass(point: LatLng, options?: QueryTenureOptions): Promise<NswTenureClass | null> {
  const endpoint = options?.endpoint ?? DEFAULT_NSW_TENURE_ENDPOINT
  const fetchImpl = options?.fetchImpl ?? fetch
  const supersededSignal = options?.signal
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = supersededSignal ? AbortSignal.any([timeoutSignal, supersededSignal]) : timeoutSignal

  const buffer = IDENTIFY_BUFFER_DEG
  const mapExtent = [point.lng - buffer, point.lat - buffer, point.lng + buffer, point.lat + buffer].join(',')
  const url =
    `${endpoint}?geometry=${point.lng},${point.lat}&geometryType=esriGeometryPoint&sr=4326` +
    `&layers=all:3&tolerance=2&mapExtent=${mapExtent}&imageDisplay=100,100,96&returnGeometry=false&f=json`

  const response = await fetchImpl(url, { signal })

  if (!response.ok) {
    throw new Error(`NSW Land Tenure request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as IdentifyResponse
  const tenureClass = data.results?.[0]?.attributes?.['Raster.TenureClas']
  return (tenureClass as NswTenureClass | undefined) ?? null
}
