import { app, ipcMain } from 'electron'
import type { BBox } from '@core/geo/types'
import type { AppInfo, AppPlatform } from '@shared/ipcContract'
import { IpcChannels } from './channels'
import { getViewpoints } from '../services/coolSpotService'

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform as AppPlatform
  }))

  ipcMain.handle(IpcChannels.getViewpoints, (_event, bbox: BBox) => getViewpoints(bbox))

  // Phase 3+ will add more coolSpotService-backed handlers here
  // (getCoolSpots with elevation/scoring/land-use filtering).
}
