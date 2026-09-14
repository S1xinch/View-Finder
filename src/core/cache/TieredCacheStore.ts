import type { CacheStore } from './CacheStore'

// CacheStore.set() takes a TTL duration, not an absolute expiry, so a
// backfill (below) doesn't know the slow store's real remaining TTL - this
// fixed short window is fine either way, since the slow store still
// enforces the real expiry independently once it lapses.
const MEMORY_BACKFILL_TTL_MS = 10 * 60 * 1000

// Checks a fast store (in-memory) first, falling back to a slower
// persistent one (e.g. DiskCacheStore) on miss, and backfills the fast
// store so a repeat hit in the same session skips the slow store entirely.
// Writes go to both, so a value cached this session is also there on the
// next app launch.
export class TieredCacheStore implements CacheStore {
  constructor(
    private fast: CacheStore,
    private slow: CacheStore
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const fastHit = await this.fast.get<T>(key)
    if (fastHit !== undefined) return fastHit

    const slowHit = await this.slow.get<T>(key)
    if (slowHit !== undefined) {
      await this.fast.set(key, slowHit, MEMORY_BACKFILL_TTL_MS)
    }
    return slowHit
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await Promise.all([this.fast.set(key, value, ttlMs), this.slow.set(key, value, ttlMs)])
  }
}
