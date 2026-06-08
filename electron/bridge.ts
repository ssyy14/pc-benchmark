export interface BenchmarkProgress {
  type: string
  phase: string
  progress: number
  metrics?: Record<string, number>
  done?: boolean
  error?: string
}

export interface BenchmarkResult {
  type: string
  score: number
  metrics: Record<string, number>
  duration: number
  skipped?: boolean
}

export interface SystemInfo {
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  totalMemoryGB: number
  osName: string
  osVersion: string
  gpuModel: string
  gpuVendor: string
}

export interface BenchmarkAPI {
  getSystemInfo: () => Promise<SystemInfo>
  runBenchmark: (type: string) => Promise<BenchmarkResult>
  onProgress: (callback: (progress: BenchmarkProgress) => void) => void
  removeProgressListener: () => void
  getStoredResults: () => Promise<BenchmarkResult[]>
  saveResults: (results: BenchmarkResult[]) => Promise<void>
  clearStoredResults: () => Promise<void>
}
