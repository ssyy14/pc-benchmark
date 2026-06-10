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
const currentPhase = ref(-1)
const result = computed(() => benchmark.resultMap['cpu'])

const phaseNames = ['Integer', 'Float', 'Crypto', 'Mixed']

function handleProgress(p: BenchmarkProgress) {
  if (p.type === 'cpu') {
    progress.value = p
    // Detect phase from icon prefix using codePointAt for emoji safety
    const icon = p.phase?.codePointAt(0)
    if (icon === 0x1F534) currentPhase.value = 0       // 🔴
    else if (icon === 0x1F7E1) currentPhase.value = 1   // 🟡
    else if (icon === 0x1F7E2) currentPhase.value = 2   // 🟢
    else if (icon === 0x1F535) currentPhase.value = 3   // 🔵
  }
}

async function start() {
  isRunning.value = true
  currentPhase.value = 0
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
    currentPhase.value = -1
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
        <p class="page-subtitle">4-phase all-core pressure test — integer, float, crypto, mixed</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <div v-if="isRunning && progress" class="bench-card mb-6">
      <!-- Phase dots indicator -->
      <div class="flex items-center justify-center gap-3 mb-3">
        <div v-for="(name, idx) in phaseNames" :key="name" class="flex items-center gap-1.5">
          <div
            class="w-3 h-3 rounded-full transition-all duration-300"
            :class="{
              'bg-blue-500 scale-125 shadow-lg shadow-blue-500/50': idx === currentPhase,
              'bg-green-500': idx < currentPhase,
              'bg-gray-600': idx !== currentPhase && !(idx < currentPhase),
            }"
          />
          <span
            class="text-xs"
            :class="idx === currentPhase ? 'text-blue-400 font-semibold' : 'text-gray-500'"
          >{{ name }}</span>
        </div>
      </div>

      <ProgressBar :progress="progress.progress" :phase="progress.phase" status="running" />

      <!-- Live per-phase metrics -->
      <div v-if="progress.metrics" class="grid grid-cols-4 gap-3 mt-4 text-center">
        <div v-if="progress.metrics.intMOps">
          <div class="text-lg font-bold text-red-400">{{ (progress.metrics.intMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">Int MOps/s</div>
        </div>
        <div v-if="progress.metrics.fpMOps">
          <div class="text-lg font-bold text-yellow-400">{{ (progress.metrics.fpMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">FP MOps/s</div>
        </div>
        <div v-if="progress.metrics.cryptoMBps">
          <div class="text-lg font-bold text-green-400">{{ progress.metrics.cryptoMBps }}</div>
          <div class="text-xs text-gray-500">Crypto MB/s</div>
        </div>
        <div v-if="progress.metrics.mixedMOps">
          <div class="text-lg font-bold text-blue-400">{{ (progress.metrics.mixedMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">Mixed MOps/s</div>
        </div>
      </div>
    </div>

    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />

      <div class="grid grid-cols-2 gap-3 mt-4">
        <div v-if="result.metrics.intMOps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔴 Integer</div>
          <div class="text-xl font-bold text-red-400">{{ (result.metrics.intMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">MOps/s</div>
        </div>
        <div v-if="result.metrics.fpMOps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟡 Float</div>
          <div class="text-xl font-bold text-yellow-400">{{ (result.metrics.fpMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">MOps/s</div>
        </div>
        <div v-if="result.metrics.cryptoMBps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟢 Crypto</div>
          <div class="text-xl font-bold text-green-400">{{ result.metrics.cryptoMBps }}</div>
          <div class="text-xs text-gray-500">MB/s</div>
        </div>
        <div v-if="result.metrics.mixedMOps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔵 Mixed</div>
          <div class="text-xl font-bold text-blue-400">{{ (result.metrics.mixedMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">MOps/s</div>
        </div>
      </div>

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
