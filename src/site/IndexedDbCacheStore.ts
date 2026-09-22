import type { CacheStore } from '@core/cache/CacheStore'

// Browser-only (IndexedDB is a DOM API) - lives in src/site/, not core/,
// for the same reason DiskCacheStore.ts's Node fs usage lives in core/ but
// this can't: core/'s own portability rule is "no Electron, no React, no
// DOM", and IndexedDB is a DOM/browser API not universally available
// (Node has no built-in equivalent).
const DB_NAME = 'view-finder-cache'
const STORE_NAME = 'entries'
const DB_VERSION = 1

interface Entry {
  value: unknown
  expiresAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// The website's equivalent of the desktop app's DiskCacheStore - a
// persistent cache that survives across page loads (a plain
// MemoryCacheStore alone starts cold on every visit), so panning back to
// an area you already visited last time you had the site open is an
// instant local read instead of a fresh Overpass/elevation round trip.
// Same CacheStore interface as every other implementation in this app, so
// it drops straight into the same TieredCacheStore(memory, persistent)
// pattern main/services/coolSpotService.ts already uses.
export class IndexedDbCacheStore implements CacheStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb()
    return this.dbPromise
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const db = await this.getDb()
      return await new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const request = tx.objectStore(STORE_NAME).get(key)
        request.onsuccess = () => {
          const entry = request.result as Entry | undefined
          if (!entry || Date.now() > entry.expiresAt) {
            resolve(undefined)
            return
          }
          resolve(entry.value as T)
        }
        request.onerror = () => reject(request.error)
      })
    } catch {
      // Missing DB support (e.g. private-browsing mode in some browsers),
      // a blocked/failed open, or any other IndexedDB hiccup - treat as a
      // miss rather than throwing; caching is a speed optimization, never
      // something a caller should have to handle failing.
      return undefined
    }
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    try {
      const db = await this.getDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const entry: Entry = { value, expiresAt: Date.now() + ttlMs }
        tx.objectStore(STORE_NAME).put(entry, key)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } catch (error) {
      console.warn('[IndexedDbCacheStore] failed to write cache entry (continuing without persistence):', error)
    }
  }
}
