// Types shared across main, preload, and renderer for the typed IPC surface.
// Kept dependency-free (no electron/react imports) so it can also be imported
// from src/core/ without violating the core/ platform-agnostic boundary.

export type AppPlatform = 'win32' | 'darwin' | 'linux'

export interface AppInfo {
  name: string
  version: string
  platform: AppPlatform
}

export interface ViewFinderApi {
  getAppInfo: () => Promise<AppInfo>
}
