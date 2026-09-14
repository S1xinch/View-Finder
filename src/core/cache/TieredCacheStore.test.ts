import { describe, expect, it } from 'vitest'
import { MemoryCacheStore } from './MemoryCacheStore'
import { TieredCacheStore } from './TieredCacheStore'

describe('TieredCacheStore', () => {
  it('returns undefined when neither store has the key', async () => {
    const tiered = new TieredCacheStore(new MemoryCacheStore(), new MemoryCacheStore())
    expect(await tiered.get('missing')).toBeUndefined()
  })

  it('returns a fast-store hit without touching the slow store', async () => {
    const fast = new MemoryCacheStore()
    const slow = new MemoryCacheStore()
    await fast.set('key', 'from-fast', 60_000)
    await slow.set('key', 'from-slow', 60_000)

    const tiered = new TieredCacheStore(fast, slow)
    expect(await tiered.get('key')).toBe('from-fast')
  })

  it('falls back to the slow store on a fast-store miss, and backfills the fast store', async () => {
    const fast = new MemoryCacheStore()
    const slow = new MemoryCacheStore()
    await slow.set('key', 'from-slow', 60_000)

    const tiered = new TieredCacheStore(fast, slow)
    expect(await tiered.get('key')).toBe('from-slow')

    // Backfilled - a second read shouldn't need the slow store at all.
    expect(await fast.get('key')).toBe('from-slow')
  })

  it('writes through to both stores on set()', async () => {
    const fast = new MemoryCacheStore()
    const slow = new MemoryCacheStore()
    const tiered = new TieredCacheStore(fast, slow)

    await tiered.set('key', 'value', 60_000)

    expect(await fast.get('key')).toBe('value')
    expect(await slow.get('key')).toBe('value')
  })
})
