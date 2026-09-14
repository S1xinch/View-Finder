import { contextBridge, ipcRenderer } from 'electron'
import type { BBox, ViewFinderApi } from '@shared/ipcContract'
import { IpcChannels } from '../main/ipc/channels'

const viewFinderAPI: ViewFinderApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo),
  getViewpoints: (bbox: BBox) => ipcRenderer.invoke(IpcChannels.getViewpoints, bbox)
}

contextBridge.exposeInMainWorld('viewFinderAPI', viewFinderAPI)
