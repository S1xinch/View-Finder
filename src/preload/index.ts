import { contextBridge, ipcRenderer } from 'electron'
import type { ViewFinderApi } from '@shared/ipcContract'
import { IpcChannels } from '../main/ipc/channels'

const viewFinderAPI: ViewFinderApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannels.getAppInfo)
}

contextBridge.exposeInMainWorld('viewFinderAPI', viewFinderAPI)
