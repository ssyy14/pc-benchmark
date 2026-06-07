<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore, type BenchmarkProgress } from '../stores/benchmark'
import { calculateCpuScore } from '../utils/scoring'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()

const isRunning = ref(false)
const progress = ref<BenchmarkProgress | null>(null)
const result = computed(() => benchmark.resultMap['cpu'])

function handleProgress(p: BenchmarkProgress) {
  if (p.type === 'cpu') progress.value = p
}

async function start() {
  isRunning.value = true
  benchmark.isRunning = true
  benchmark.runningType = 'cpu'
  window.benchmarkAPI.onProgress(handleProgress)
  try {
    const r = await window.benchmarkAPI.runBenchmark('cpu')
    const score = calculateCpuScore(r.metrics)
    benchmark.setResult({ ...r, score })
  } catch (e) {
    console.error('CPU benchmark failed:', e)
  } finally {
    isRunning.value = false
    benchmark.isRunning = false
    benchmark.runningType = null
    window.benchmarkAPI.removeProgressListener()
  }
}

onUnmounted(() => {
  window.benchmarkAPI?.removeProgressListener()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">⚡ {{ $t('nav.cpu') }}</h2>
        <p class="page-subtitle">Single-core, multi-core, and crypto performance</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <div v-if="isRunning && progress" class="bench-card mb-6">
      <ProgressBar :progress="progress.progress" :phase="progress.phase" status="running" />
      <div v-if="progress.metrics" class="grid grid-cols-3 gap-4 mt-4 text-center">
        <div v-if="progress.metrics.singleCoreMOps">
          <div class="text-2xl font-bold text-blue-600">{{ progress.metrics.singleCoreMOps.toFixed(1) }}</div>
          <div class="text-xs text-gray-400">Single-core MOps/s</div>
        </div>
        <div v-if="progress.metrics.multiCoreMOps">
          <div class="text-2xl font-bold text-blue-600">{{ progress.metrics.multiCoreMOps.toFixed(1) }}</div>
          <div class="text-xs text-gray-400">Multi-core MOps/s</div>
        </div>
        <div v-if="progress.metrics.cryptoMBps">
          <div class="text-2xl font-bold text-blue-600">{{ progress.metrics.cryptoMBps }}</div>
          <div class="text-xs text-gray-400">Crypto MB/s</div>
        </div>
      </div>
    </div>

    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />
      <div class="text-center text-sm text-gray-400 mt-2">
        {{ $t('benchmark.duration') }}: {{ (result.duration / 1000).toFixed(1) }}{{ $t('common.seconds') }}
      </div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">⚡</div>
      <p>{{ $t('benchmark.notRun') }}</p>
    </div>
  </div>
</template>
