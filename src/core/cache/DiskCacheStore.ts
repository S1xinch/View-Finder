import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CacheStore } from './CacheStore'

interface Entry {
  value: unknown
  expiresAt: number
}

// Cache keys here are always our own bboxKey()-style strings
// (e.g. "viewpoints:150.300,-33.700,150.550,-33.450"), never user input,
// but this still guards against unexpected characters landing in a path.
function keyToFilename(key: string): string {
  return `${key.replace(/[^a-zA-Z0-9_.-]/g, '_')}.json`
}

// Disk-backed cache so repeated pans over the same area stay fast across
// app restarts, not just within a single session (see MemoryCacheStore for
// the in-session-only version, and TieredCacheStore for how the two
// combine). One JSON file per key under `baseDir` - simple enough not to
// need a real embedded database at this app's scale (a handful of tiles
// per viewport, long TTLs already in coolSpotService.ts).
export class DiskCacheStore implements CacheStore {
  constructor(private baseDir: string) {}

  private pathFor(key: string): string {
    return join(this.baseDir, keyToFilename(key))
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = await readFile(this.pathFor(key), 'utf-8')
      const entry = JSON.parse(raw) as Entry
      if (Date.now() > entry.expiresAt) return undefined
      return entry.value as T
    } catch {
      // Missing file (cache miss) or corrupt JSON - either way, treat as a
      // miss rather than throwing; caching is a speed optimization, never
      // something a caller should have to handle failing.
      return undefined
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      await mkdir(this.baseDir, { recursive: true })
      const entry: Entry = { value, expiresAt: Date.now() + ttlMs }
      await writeFile(this.pathFor(key), JSON.stringify(entry), 'utf-8')
    } catch (error) {
      console.warn('[DiskCacheStore] failed to write cache entry (continuing without persistence):', error)
    }
  }
}
