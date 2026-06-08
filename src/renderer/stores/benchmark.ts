import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  calculateCpuScore,
  calculateMemoryScore,
  calculateDiskScore,
  calculateGpuScore,
  calculateGraphicsScore,
} from '../utils/scoring'

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

  const scoreCalculators: Record<string, (m: Record<string, number>) => number> = {
    cpu: calculateCpuScore,
    memory: calculateMemoryScore,
    disk: calculateDiskScore,
    gpu: calculateGpuScore,
    graphics: calculateGraphicsScore,
  }

  function calcScoreForType(type: string, metrics: Record<string, number>): number {
    return (scoreCalculators[type] || (() => 0))(metrics)
  }

  function setProgress(p: BenchmarkProgress) {
    currentProgress.value = p
  }

  function persist() {
    try { window.benchmarkAPI?.saveResults(JSON.parse(JSON.stringify(results.value))) } catch { /* not in Electron */ }
  }

  function setResult(r: BenchmarkResult) {
    const scored = { ...r, score: calcScoreForType(r.type, r.metrics) }
    const idx = results.value.findIndex((x) => x.type === r.type)
    if (idx >= 0) results.value[idx] = scored
    else results.value.push(scored)
    persist()
  }

  function setResults(arr: BenchmarkResult[]) {
    results.value = arr.map((r) => ({
      ...r,
      score: calcScoreForType(r.type, r.metrics),
    }))
    persist()
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
