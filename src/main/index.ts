import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc/handlers'
import { registerAppProtocolHandler, registerAppSchemeAsPrivileged } from './protocol'

// Must be called before app.whenReady() - see protocol.ts.
registerAppSchemeAsPrivileged()

app.whenReady().then(() => {
  registerAppProtocolHandler(join(__dirname, '../renderer'))
  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
