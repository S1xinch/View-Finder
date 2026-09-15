import { contextBridge, ipcRenderer } from 'electron'
import type { BBox, LatLng, ViewFinderApi, Viewpoint, ViewpointsProgress } from '@shared/ipcContract'
import { IpcChannels } from '../main/ipc/channels'

// ipcRenderer.invoke() is one-shot request/response - it can't also carry
// the incremental per-tile progress pushed from main mid-request (see
// handlers.ts). Each call gets its own token so its listener only reacts
// to *its* progress events, not a still-finishing older (superseded) call's
// - main echoes back whatever token it was given.
let nextProgressToken = 0

function getViewpoints(bbox: BBox, onProgress?: (progress: ViewpointsProgress) => void): Promise<Viewpoint[]> {
  if (!onProgress) return ipcRenderer.invoke(IpcChannels.getViewpoints, bbox)

  const progressToken = nextProgressToken++
  const listener = (_event: unknown, payload: ViewpointsProgress & { progressToken: number }): void => {
    if (payload.progressToken !== progressToken) return
    // payload's extra progressToken field is structurally harmless to pass
    // straight through - onProgress only reads the ViewpointsProgress
    // fields it declares.
    onProgress(payload)
  }
  ipcRenderer.on(IpcChannels.viewpointsProgress, listener)

  return ipcRenderer
    .invoke(IpcChannels.getViewpoints, bbox, progressToken)
    .finally(() => ipcRenderer.removeListener(IpcChannels.viewpointsProgress, listener))
}

const viewFinderAPI: ViewFinderApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  getViewpoints,
  getExcludedLand: (bbox: BBox) => ipcRenderer.invoke(IpcChannels.getExcludedLand, bbox),
  getRoute: (from: LatLng, to: LatLng) => ipcRenderer.invoke(IpcChannels.getRoute, from, to),
  searchPlaces: (query: string) => ipcRenderer.invoke(IpcChannels.searchPlaces, query)
}

contextBridge.exposeInMainWorld('viewFinderAPI', viewFinderAPI)
