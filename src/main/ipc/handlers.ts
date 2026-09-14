import { app, ipcMain } from 'electron'
import type { BBox } from '@core/geo/types'
import type { LatLng } from '@core/routing/types'
import type { AppInfo, AppPlatform } from '@shared/ipcContract'
import { IpcChannels } from './channels'
import { getExcludedLand, getViewpoints } from '../services/coolSpotService'
import { getRoute } from '../services/routeService'

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.getAppInfo, (): AppInfo => {
    console.log('[ipc] getAppInfo invoked - preload/IPC bridge is working')
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform as AppPlatform
    }
  })

  ipcMain.handle(IpcChannels.getViewpoints, async (_event, bbox: BBox) => {
    try {
      return await getViewpoints(bbox)
    } catch (error) {
      // A superseded-by-a-newer-request abort is expected/benign during
      // rapid panning, not a real failure - log it quietly rather than as
      // an error, and the renderer's staleness guard already drops it
      // silently from the UI either way.
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ipc] getViewpoints aborted (superseded)')
      } else {
        console.error('[ipc] getViewpoints failed:', error)
      }
      throw error
    }
  })

  ipcMain.handle(IpcChannels.getExcludedLand, async (_event, bbox: BBox) => {
    try {
      return await getExcludedLand(bbox)
    } catch (error) {
      console.error('[ipc] getExcludedLand failed:', error)
      throw error
    }
  })

  ipcMain.handle(IpcChannels.getRoute, async (_event, from: LatLng, to: LatLng) => {
    try {
      return await getRoute(from, to)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ipc] getRoute aborted (superseded)')
      } else {
        console.error('[ipc] getRoute failed:', error)
      }
      throw error
    }
  })
}
