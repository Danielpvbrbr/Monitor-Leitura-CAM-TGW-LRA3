import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  onNovaPlaca: (callback) => ipcRenderer.on('nova-leitura-placa', (_event, value) => callback(value)),
  onAtualizarCameras: (callback) => ipcRenderer.on('atualizar-lista-cameras', () => callback()),
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  getCameras: () => ipcRenderer.invoke('get-cameras'),
  salvarCamera: (cam) => ipcRenderer.invoke('salvar-camera', cam),
  deletarCamera: (mac) => ipcRenderer.invoke('deletar-camera', mac),
  getLogs: (macFiltro) => ipcRenderer.invoke('get-logs', macFiltro)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
