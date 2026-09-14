/// <reference types="vite/client" />

import type { ViewFinderApi } from '@shared/ipcContract'

declare global {
  interface Window {
    viewFinderAPI: ViewFinderApi
  }
}
