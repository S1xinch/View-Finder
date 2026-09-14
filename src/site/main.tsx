import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@renderer/App'
import { webApi } from './webApi'

// The renderer's App.tsx and every component under it only ever touch
// window.viewFinderAPI - they don't know or care whether that's backed by
// Electron's IPC or, as here, a plain in-page implementation. Setting
// this before the first render is the entire integration surface between
// the website build and the desktop app's UI code (App.tsx imports its
// own CSS, so nothing else is needed here).
window.viewFinderAPI = webApi

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
