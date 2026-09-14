import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiskCacheStore } from './DiskCacheStore'

describe('DiskCacheStore', () => {
  let dir: string
  let store: DiskCacheStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'view-finder-cache-test-'))
    store = new DiskCacheStore(dir)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns undefined for a key that was never set', async () => {
    expect(await store.get('missing')).toBeUndefined()
  })

  it('round-trips a value written by set()', async () => {
    await store.set('tile:1', { hello: 'world' }, 60_000)
    expect(await store.get('tile:1')).toEqual({ hello: 'world' })
  })

  it('creates the base directory on first write if it does not exist yet', async () => {
    const freshStore = new DiskCacheStore(join(dir, 'nested', 'cache'))
    await freshStore.set('tile:1', [1, 2, 3], 60_000)
    expect(await freshStore.get('tile:1')).toEqual([1, 2, 3])
  })

  it('treats an expired entry as a miss', async () => {
    vi.useFakeTimers()
    try {
      await store.set('tile:1', 'value', 1_000)
      vi.advanceTimersByTime(1_001)
      expect(await store.get('tile:1')).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('persists across separate store instances pointed at the same directory', async () => {
    await store.set('tile:1', 'persisted', 60_000)
    const reopened = new DiskCacheStore(dir)
    expect(await reopened.get('tile:1')).toBe('persisted')
  })

  it('sanitizes keys with characters that are unsafe in filenames', async () => {
    const key = 'viewpoints:150.300,-33.700,150.550,-33.450'
    await store.set(key, 'ok', 60_000)
    expect(await store.get(key)).toBe('ok')
  })
})
