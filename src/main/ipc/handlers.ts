import { app, ipcMain } from 'electron'
import type { BBox } from '@core/geo/types'
import type { LatLng } from '@core/routing/types'
import type { ViewpointsProgress } from '@core/services/coolSpotOrchestrator'
import type { AppInfo, AppPlatform } from '@shared/ipcContract'
import { IpcChannels } from './channels'
import { getExcludedLand, getViewpoints } from '../services/coolSpotService'
import { getRoute } from '../services/routeService'
import { searchPlaces } from '../services/placeSearchService'

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.getAppInfo, (): AppInfo => {
    console.log('[ipc] getAppInfo invoked - preload/IPC bridge is working')
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform as AppPlatform
    }
  })

  ipcMain.handle(IpcChannels.getViewpoints, async (event, bbox: BBox, progressToken?: number) => {
    try {
      // progressToken is an opaque id the preload bridge generates per
      // call (see preload/index.ts) purely to route this specific call's
      // progress events back to its own listener - main doesn't attach
      // any meaning to it beyond echoing it back on every push.
      const onProgress =
        progressToken == null
          ? undefined
          : (progress: ViewpointsProgress): void => {
              event.sender.send(IpcChannels.viewpointsProgress, { progressToken, ...progress })
            }
      return await getViewpoints(bbox, onProgress)
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

  ipcMain.handle(IpcChannels.searchPlaces, async (_event, query: string) => {
    try {
      return await searchPlaces(query)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ipc] searchPlaces aborted (superseded)')
      } else {
        console.error('[ipc] searchPlaces failed:', error)
      }
      throw error
    }
  })
}
