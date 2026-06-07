import { contextBridge, ipcRenderer } from 'electron'
import type { BenchmarkAPI } from './bridge'

const api: BenchmarkAPI = {
  getSystemInfo: () => ipcRenderer.invoke('system:info'),

  runBenchmark: (type: string) => ipcRenderer.invoke('benchmark:run', type),

  runAllBenchmarks: () => ipcRenderer.invoke('benchmark:run-all'),

  onProgress: (callback) => {
    ipcRenderer.on('benchmark:progress', (_event, data) => callback(data))
  },

  removeProgressListener: () => {
    ipcRenderer.removeAllListeners('benchmark:progress')
  },

  getStoredResults: () => ipcRenderer.invoke('results:get'),

  clearStoredResults: () => ipcRenderer.invoke('results:clear'),
}

contextBridge.exposeInMainWorld('benchmarkAPI', api)
