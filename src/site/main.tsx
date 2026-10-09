import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@renderer/App'
import { webApi } from './webApi'
import { applyDeviceCorners } from './screenCorners'
import { offlineSupport } from '@renderer/utils/offlineArea'

// The renderer's App.tsx and every component under it only ever touch
// window.viewFinderAPI - they don't know or care whether that's backed by
// Electron's IPC or, as here, a plain in-page implementation. Setting
// this before the first render is the entire integration surface between
// the website build and the desktop app's UI code (App.tsx imports its
// own CSS, so nothing else is needed here).
window.viewFinderAPI = webApi
// Before the first render, so the sheet's first layout/peek measurement
// already accounts for the device-corner geometry.
applyDeviceCorners()

// Offline maps (build/sw.js). Registered in production only - in dev the
// worker's caching would fight Vite's hot reload - but the save button
// works in both, since saving only needs Cache Storage.
offlineSupport.enabled = 'caches' in window && 'serviceWorker' in navigator
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch((error: unknown) => console.warn('[sw] registration failed', error))
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
