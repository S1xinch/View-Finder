import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from './utils/env'
import { appUrl } from './protocol'

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f4f0',
    webPreferences: {
      // .cjs, not .mjs: see the preload build config in
      // electron.vite.config.ts for why (Electron's preload loader choked
      // on an ES module preload script).
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.on('ready-to-show', () => window.show())

  // Renderer console.log/error/warn otherwise only go to DevTools, which is
  // easy to miss (and awkward to ask a non-technical user to open). Forward
  // it into the same terminal `npm run dev` runs in so both processes' logs
  // are visible in one place.
  window.webContents.on('console-message', (event) => {
    const consoleFn = event.level === 'warning' ? console.warn : event.level === 'error' ? console.error : console.log
    consoleFn(`[renderer] ${event.message}`)
  })

  // Open external links (e.g. an OSM "view on osm.org" link) in the OS browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // Not loadFile()/file:// - see protocol.ts for why the packaged
    // renderer is served over a custom app:// scheme instead.
    window.loadURL(appUrl())
  }

  return window
}
