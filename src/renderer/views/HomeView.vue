<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useBenchmarkStore, type BenchmarkProgress, type BenchmarkResult } from '../stores/benchmark'
import SystemInfoComponent from '../components/SystemInfo.vue'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import type { SystemInfo } from '../utils/system-info'
import { useGpuBenchmark } from '../composables/useGpuBenchmark'
import { useGraphicsBenchmark } from '../composables/useGraphicsBenchmark'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const router = useRouter()
const benchmark = useBenchmarkStore()
const gpuBench = useGpuBenchmark()
const gfxBench = useGraphicsBenchmark()

const info = ref<SystemInfo | null>(null)
const infoLoading = ref(true)
const runningAll = ref(false)
const runAllProgress = ref(0)
const runAllPhase = ref('')
const runAllCurrent = ref('')

// Hidden canvases for GPU/Graphics benchmarks during Run All
const gpuCanvas = ref<HTMLCanvasElement | null>(null)
const gfxCanvas = ref<HTMLCanvasElement | null>(null)

onMounted(async () => {
  try {
    info.value = await window.benchmarkAPI.getSystemInfo()
    const stored = await window.benchmarkAPI.getStoredResults()
    if (stored && stored.length > 0) benchmark.setResults(stored)
  } catch (e) {
    console.error('Failed to initialize:', e)
  } finally {
    infoLoading.value = false
  }
})

const IPC_TYPES = ['cpu', 'memory', 'disk'] as const
const TOTAL_STEPS = IPC_TYPES.length + 2 // + GPU + Graphics

async function runSingleIpc(type: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (p: BenchmarkProgress) => {
      if (p.type === type) {
        runAllPhase.value = `${type.toUpperCase()}: ${p.phase}`
        runAllProgress.value = Math.round(p.progress)
      }
    }
    window.benchmarkAPI.onProgress(handler)
    window.benchmarkAPI.runBenchmark(type).then((result: BenchmarkResult) => {
      window.benchmarkAPI.removeProgressListener()
      // Recalculate score from metrics
      benchmark.setResult(result)
      resolve()
    }).catch(reject)
  })
}

async function runAll() {
  runningAll.value = true
  benchmark.isRunning = true
  benchmark.runningType = 'all'
  let step = 0

  const updateStep = (name: string) => {
    step++
    runAllCurrent.value = name
    runAllProgress.value = Math.round((step / TOTAL_STEPS) * 100)
  }

  try {
    // Phase 1: CPU, Memory, Disk via IPC workers
    for (const type of IPC_TYPES) {
      runAllCurrent.value = type.toUpperCase()
      runAllPhase.value = `Starting ${type} benchmark...`
      runAllProgress.value = Math.round((step / TOTAL_STEPS) * 100)
      await runSingleIpc(type)
      updateStep(type.toUpperCase())
    }

    // Phase 2: GPU — real WebGL burn-in in renderer
    runAllCurrent.value = 'GPU'
    runAllPhase.value = '4K WebGL GPU burn-in...'
    await gpuBench.run(gpuCanvas.value || undefined)
    updateStep('GPU')

    // Phase 3: Graphics — real WebGL particle system in renderer
    runAllCurrent.value = 'Graphics'
    runAllPhase.value = 'WebGL particle system...'
    await gfxBench.run(gfxCanvas.value || undefined)
    updateStep('Graphics')

    runAllPhase.value = 'Complete!'
    runAllProgress.value = 100
  } catch (e) {
    console.error('Benchmark failed:', e)
  } finally {
    runningAll.value = false
    benchmark.isRunning = false
    benchmark.runningType = null
    router.push('/report')
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">{{ t('home.title') }}</h2>
        <p class="page-subtitle">{{ t('app.subtitle') }}</p>
      </div>
      <NButton type="primary" size="large" :loading="runningAll" @click="runAll">
        ⚡ {{ t('home.startAll') }}
      </NButton>
    </div>

    <!-- Hidden canvases for Run All GPU/Graphics tests -->
    <canvas ref="gpuCanvas" style="display:none" />
    <canvas ref="gfxCanvas" style="display:none" />

    <!-- Run All progress -->
    <div v-if="runningAll" class="bench-card mb-6">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-sm font-medium text-gray-700">{{ runAllCurrent }}</span>
        <span class="text-xs text-gray-400">{{ runAllPhase }}</span>
      </div>
      <ProgressBar :progress="runAllProgress" :phase="runAllPhase" status="running" />
    </div>

    <SystemInfoComponent :info="info" :loading="infoLoading" />

    <div v-if="benchmark.overallScore > 0 && !runningAll" class="mt-6">
      <ScoreCard :score="benchmark.overallScore" :label="t('report.overallScore')" :show-tier="true" size="large" />
    </div>
  </div>
</template>
