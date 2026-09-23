import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Viewpoint } from '@shared/ipcContract'

// A minimal in-memory localStorage - the store reads it once at import time.
function installStorage(initial: Record<string, string> = {}): Map<string, string> {
  const data = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v)
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
