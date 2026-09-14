import type { CacheStore } from './CacheStore'

interface Entry {
  value: unknown
  expiresAt: number
}

// Same-session in-memory cache so repeated pans over the same viewport
// don't refetch. A disk-backed store (node:sqlite, see architecture notes)
// can be layered in later for cross-session persistence without callers
// changing, since both implement CacheStore.
export class MemoryCacheStore implements CacheStore {
  private store = new Map<string, Entry>()

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value as T
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
}
