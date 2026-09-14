import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from './utils/env'

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
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false
      // Deliberately not setting sandbox: true. Combined with an ES module
      // preload script (which "type": "module" in package.json forces,
      // i.e. index.mjs), Electron's sandboxed preload loading has had
      // long-standing reliability issues across versions - in practice
      // contextBridge.exposeInMainWorld silently never runs, leaving
      // window.viewFinderAPI undefined in the renderer with no error
      // anywhere. contextIsolation + nodeIntegration: false already give
      // the renderer no direct Node/Electron access; sandbox is stricter
      // still but not worth this failure mode for what this app needs.
    }
  })

  window.on('ready-to-show', () => window.show())

  // Open external links (e.g. an OSM "view on osm.org" link) in the OS browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
