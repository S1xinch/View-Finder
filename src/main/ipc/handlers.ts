import { app, ipcMain } from 'electron'
import type { AppInfo, AppPlatform } from '@shared/ipcContract'
import { IpcChannels } from './channels'

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as AppPlatform
  }))

  // Phase 2+ will add coolSpotService-backed handlers here
  // (getViewpoints, getCoolSpots, ...).
}
