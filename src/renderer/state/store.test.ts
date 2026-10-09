import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Viewpoint } from '@shared/ipcContract'

// A minimal in-memory localStorage - the store reads it once at import time.
function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k)
  })
  return data
}

async function freshStore() {
  vi.resetModules()
  return (await import('./store')).useViewFinderStore
}

const spot: Viewpoint = {
  id: 'osm:node:1',
  name: 'Example Lookout',
  lat: -33.6,
  lng: 150.3,
  category: 'viewpoint',
  tags: { tourism: 'viewpoint', description: 'long text nobody reads' }
}

describe('saved spots', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('toggles a spot in and out, persisting without its raw tags', async () => {
    const data = installStorage()
    const store = await freshStore()

    store.getState().toggleSavedSpot(spot)
    expect(store.getState().savedSpots).toEqual([{ ...spot, tags: {} }])
    expect(JSON.parse(data.get('vf-saved-spots')!)).toEqual([{ ...spot, tags: {} }])

    store.getState().toggleSavedSpot(spot)
    expect(store.getState().savedSpots).toEqual([])
    expect(JSON.parse(data.get('vf-saved-spots')!)).toEqual([])
  })

  it('reloads saved spots, dropping malformed entries', async () => {
    installStorage({ 'vf-saved-spots': JSON.stringify([{ ...spot, tags: {} }, { id: 'broken' }, null]) })
    const store = await freshStore()
    expect(store.getState().savedSpots).toEqual([{ ...spot, tags: {} }])
  })

  it('starts empty when stored data is not valid JSON', async () => {
    installStorage({ 'vf-saved-spots': '{not json' })
    const store = await freshStore()
    expect(store.getState().savedSpots).toEqual([])
  })
})

describe('access reports', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('overrides the data flag both ways, persists, and undoes cleanly', async () => {
    const data = installStorage()
    const store = await freshStore()
    const { withAccessReport } = await import('./store')
    const gated: Viewpoint = { ...spot, restricted: 'gated' }

    store.getState().setAccessReport(spot.id, 'open')
    expect(withAccessReport(gated, store.getState().accessReports).restricted).toBeUndefined()

    store.getState().setAccessReport(spot.id, 'closed')
    expect(withAccessReport(spot, store.getState().accessReports).restricted).toBe('reported')
    expect(withAccessReport(gated, store.getState().accessReports).restricted).toBe('gated')
    expect(JSON.parse(data.get('vf-access-reports')!)).toEqual({ [spot.id]: 'closed' })

    store.getState().setAccessReport(spot.id, null)
    expect(withAccessReport(gated, store.getState().accessReports)).toBe(gated)
  })

  it('ignores malformed stored reports', async () => {
    installStorage({ 'vf-access-reports': JSON.stringify({ a: 'open', b: 'maybe', c: 3 }) })
    const store = await freshStore()
    expect(store.getState().accessReports).toEqual({ a: 'open' })
  })
})

describe('active drive', () => {
  beforeEach(() => vi.unstubAllGlobals())
  const route = { coordinates: [[150.3, -33.6]] as [number, number][], distanceMeters: 1000, durationSeconds: 60, steps: [] }

  it('keeps the loaded route across a reload and forgets it when cleared', async () => {
    const data = installStorage()
    let store = await freshStore()
    store.getState().requestRoute(spot)
    store.getState().setRouteLoaded(route)

    store = await freshStore()
    expect(store.getState().routeDestination?.id).toBe(spot.id)
    expect(store.getState().route).toEqual(route)
    expect(store.getState().routeStatus).toBe('ready')

    store.getState().clearRoute()
    expect(data.has('vf-active-drive')).toBe(false)
  })

  it('drops a drive saved more than half a day ago', async () => {
    installStorage({ 'vf-active-drive': JSON.stringify({ at: Date.now() - 13 * 3600_000, destination: spot, route }) })
    const store = await freshStore()
    expect(store.getState().route).toBeNull()
  })
})
