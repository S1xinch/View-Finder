import { contextBridge, ipcRenderer } from 'electron'
import type { BBox, LatLng, ViewFinderApi } from '@shared/ipcContract'
import { IpcChannels } from '../main/ipc/channels'

const viewFinderAPI: ViewFinderApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  getViewpoints: (bbox: BBox) => ipcRenderer.invoke(IpcChannels.getViewpoints, bbox),
  getExcludedLand: (bbox: BBox) => ipcRenderer.invoke(IpcChannels.getExcludedLand, bbox),
  getRoute: (from: LatLng, to: LatLng) => ipcRenderer.invoke(IpcChannels.getRoute, from, to)
}

contextBridge.exposeInMainWorld('viewFinderAPI', viewFinderAPI)
