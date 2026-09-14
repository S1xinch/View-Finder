/// <reference types="vite/client" />

import type { ViewFinderApi } from '@shared/ipcContract'

declare global {
  interface Window {
    viewFinderAPI: ViewFinderApi
  }

  // Injected by electron.vite.config.ts's `define` at build/dev time.
  const __APP_VERSION__: string
  const __GIT_COMMIT__: string
}
