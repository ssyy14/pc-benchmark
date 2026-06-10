<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore } from '../stores/benchmark'
import { useGpuBenchmark } from '../composables/useGpuBenchmark'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()
const { isRunning, progressPercent, progressPhase, liveValue, canvasRef, currentPhaseIndex, run } = useGpuBenchmark()

const result = computed(() => benchmark.resultMap['gpu'])

const phaseNames = ['Fillrate', 'Geometry', 'Compute', 'Bandwidth']
const phaseIcons = ['🔴', '🟡', '🟢', '🔵']
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">🎮 {{ $t('nav.gpu') }}</h2>
        <p class="page-subtitle">4-phase GPU pressure test — fillrate, geometry, compute, bandwidth</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="run()">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <!-- LIVE CANVAS PREVIEW -->
    <div v-if="isRunning" class="bench-card mb-6">
      <!-- Phase dots indicator -->
      <div class="flex items-center justify-center gap-3 mb-3">
        <div
          v-for="(name, idx) in phaseNames"
          :key="name"
          class="flex items-center gap-1.5"
        >
          <div
            class="w-3 h-3 rounded-full transition-all duration-300"
            :class="{
              'bg-blue-500 scale-125 shadow-lg shadow-blue-500/50': idx === currentPhaseIndex,
              'bg-green-500': idx < (currentPhaseIndex >= 0 ? currentPhaseIndex : 999),
              'bg-gray-600': idx !== currentPhaseIndex && !(idx < (currentPhaseIndex >= 0 ? currentPhaseIndex : 999)),
            }"
          />
          <span
            class="text-xs"
            :class="idx === currentPhaseIndex ? 'text-blue-400 font-semibold' : 'text-gray-500'"
          >{{ name }}</span>
        </div>
      </div>

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

    <!-- RESULTS -->
    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />

      <!-- Per-phase metrics -->
      <div class="grid grid-cols-2 gap-3 mt-4">
        <div v-if="result.metrics.fillrateMPix" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔴 Fillrate</div>
          <div class="text-xl font-bold text-red-400">{{ (result.metrics.fillrateMPix / 1000).toFixed(1) }}G</div>
          <div class="text-xs text-gray-500">Pix/s</div>
        </div>
        <div v-if="result.metrics.geometryMTri" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟡 Geometry</div>
          <div class="text-xl font-bold text-yellow-400">{{ result.metrics.geometryMTri.toLocaleString() }}</div>
          <div class="text-xs text-gray-500">MTri/s</div>
        </div>
        <div v-if="result.metrics.computeMPix" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟢 Compute</div>
          <div class="text-xl font-bold text-green-400">{{ (result.metrics.computeMPix / 1000).toFixed(1) }}G</div>
          <div class="text-xs text-gray-500">Pix/s</div>
        </div>
        <div v-if="result.metrics.bandwidthGBps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔵 Bandwidth</div>
          <div class="text-xl font-bold text-blue-400">{{ result.metrics.bandwidthGBps }}</div>
          <div class="text-xs text-gray-500">GB/s</div>
        </div>
      </div>

      <div class="text-center text-sm text-gray-400 mt-2">
        {{ $t('benchmark.duration') }}: {{ (result.duration / 1000).toFixed(1) }}{{ $t('common.seconds') }}
      </div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">🎮</div>
      <p>{{ $t('benchmark.notRun') }}</p>
    </div>
  </div>
</template>
