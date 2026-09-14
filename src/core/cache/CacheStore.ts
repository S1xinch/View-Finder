export interface CacheStore {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlMs: number): Promise<void>
}
