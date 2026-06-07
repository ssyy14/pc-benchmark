export interface SystemInfo {
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  totalMemoryGB: number
  osName: string
  osVersion: string
  gpuModel: string
}

export async function detectSystemInfo(): Promise<SystemInfo> {
  if (window.benchmarkAPI) {
    return window.benchmarkAPI.getSystemInfo()
  }
  throw new Error('benchmarkAPI not available (not running in Electron)')
}
