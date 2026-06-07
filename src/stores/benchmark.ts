import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface BenchmarkResult {
  type: string
  score: number
  metrics: Record<string, number>
  duration: number
  skipped?: boolean
}

export interface BenchmarkProgress {
  type: string
  phase: string
  progress: number
  metrics?: Record<string, number>
}

export const useBenchmarkStore = defineStore('benchmark', () => {
  const results = ref<BenchmarkResult[]>([])
  const currentProgress = ref<BenchmarkProgress | null>(null)
  const isRunning = ref(false)
  const runningType = ref<string | null>(null)

  const overallScore = computed(() => {
    if (results.value.length === 0) return 0
    const weights: Record<string, number> = {
      cpu: 0.30,
      memory: 0.15,
      disk: 0.15,
      gpu: 0.25,
      graphics: 0.15,
    }
    let total = 0
    let weightSum = 0
    for (const r of results.value) {
      if (!r.skipped) {
        total += r.score * (weights[r.type] || 0)
        weightSum += weights[r.type] || 0
      }
    }
    return weightSum > 0 ? Math.round(total / weightSum) : 0
  })

  const resultMap = computed(() => {
    const map: Record<string, BenchmarkResult> = {}
    for (const r of results.value) map[r.type] = r
    return map
  })

  function norm(raw: number, ref: number, lowerIsBetter = false): number {
    if (ref === 0) return 0
    return Math.round(
      Math.min(10000, Math.max(0, lowerIsBetter ? (ref / Math.max(raw, 0.001)) * 5000 : (raw / ref) * 5000))
    )
  }

  function calcScoreForType(type: string, metrics: Record<string, number>): number {
    const m = metrics
    switch (type) {
      case 'cpu':
        return Math.round(norm(m.singleCoreMOps || 0, 5000) * 0.25 + norm(m.multiCoreMOps || 0, 20000) * 0.55 + norm(m.cryptoMBps || 0, 2000) * 0.20)
      case 'memory':
        return Math.round(norm(m.readBandwidthMBps || 0, 30 * 1024) * 0.35 + norm(m.writeBandwidthMBps || 0, 20 * 1024) * 0.25 + norm(m.latencyNs || 100, 80, true) * 0.40)
      case 'disk':
        return Math.round(norm(m.seqReadMBps || 0, 2000) * 0.25 + norm(m.seqWriteMBps || 0, 1000) * 0.20 + norm(m.randomReadIOPS || 0, 50000) * 0.30 + norm(m.randomWriteIOPS || 0, 30000) * 0.25)
      case 'gpu':
        return Math.round(norm(m.computeGFLOPS || 0, 2000) * 0.60 + norm(m.memoryBandwidthGBps || 0, 200) * 0.40)
      case 'graphics':
        return Math.round(norm(m.fps1080p || 0, 60) * 0.50 + norm(m.fps720p || 0, 90) * 0.30 + norm(m.fps480p || 0, 120) * 0.20)
      default:
        return 0
    }
  }

  function setProgress(p: BenchmarkProgress) {
    currentProgress.value = p
  }

  function setResult(r: BenchmarkResult) {
    const scored = { ...r, score: calcScoreForType(r.type, r.metrics) }
    const idx = results.value.findIndex((x) => x.type === r.type)
    if (idx >= 0) results.value[idx] = scored
    else results.value.push(scored)
  }

  function setResults(arr: BenchmarkResult[]) {
    results.value = arr.map((r) => ({
      ...r,
      score: calcScoreForType(r.type, r.metrics),
    }))
  }

  function clearResults() {
    results.value = []
  }

  return {
    results,
    currentProgress,
    isRunning,
    runningType,
    overallScore,
    resultMap,
    setProgress,
    setResult,
    setResults,
    clearResults,
  }
})
