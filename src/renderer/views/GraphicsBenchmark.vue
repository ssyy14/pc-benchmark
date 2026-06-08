<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore } from '../stores/benchmark'
import { useGraphicsBenchmark } from '../composables/useGraphicsBenchmark'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()
const { isRunning, progressPercent, progressPhase, liveValue, canvasRef, run } = useGraphicsBenchmark()

const result = computed(() => benchmark.resultMap['graphics'])
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">🏙️ {{ $t('nav.graphics') }}</h2>
        <p class="page-subtitle">3D City Rendering — PBR materials, shadow mapping, bloom post-processing, 2000+ buildings</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="run()">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <!-- LIVE 3D CITY CANVAS -->
    <div v-if="isRunning" class="bench-card mb-6">
      <canvas
        ref="canvasRef"
        class="w-full rounded-lg"
        style="max-height: 400px; object-fit: contain; background: #000"
      />
      <div class="mt-3">
        <ProgressBar :progress="progressPercent" :phase="progressPhase" status="running" />
      </div>
      <div v-if="liveValue" class="text-center mt-2">
        <div class="text-3xl font-bold text-[#2563eb]">{{ liveValue }}</div>
      </div>
    </div>

    <div v-if="result && !result.skipped">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />
      <div class="grid grid-cols-2 gap-4 mt-4 text-center">
        <div class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.fpsMax || result.metrics.fpsAvg }}</div>
          <div class="text-xs text-gray-400">Peak GPU FPS</div>
        </div>
        <div class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.fpsAvg }}</div>
          <div class="text-xs text-gray-400">Avg FPS</div>
        </div>
        <div class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.buildings }}</div>
          <div class="text-xs text-gray-400">Buildings Rendered</div>
        </div>
        <div class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ (result.duration / 1000).toFixed(1) }}s</div>
          <div class="text-xs text-gray-400">Duration</div>
        </div>
      </div>
      <div class="text-center text-sm text-gray-400 mt-2">
        {{ $t('benchmark.duration') }}: {{ (result.duration / 1000).toFixed(1) }}{{ $t('common.seconds') }}
      </div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">🏙️</div>
      <p>{{ $t('benchmark.notRun') }}</p>
    </div>

    <div v-if="result && result.skipped" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">⚠️</div>
      <p class="text-red-500 font-medium">Benchmark failed</p>
      <p class="text-xs text-gray-500 mt-2 font-mono">{{ result.metrics?.msg || 'Unknown error' }}</p>
    </div>
  </div>
</template>
