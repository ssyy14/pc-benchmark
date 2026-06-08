<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore } from '../stores/benchmark'
import ScoreCard from '../components/ScoreCard.vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, RadarComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([RadarChart, TitleComponent, TooltipComponent, LegendComponent, RadarComponent, CanvasRenderer])

const { t } = useI18n()
const benchmark = useBenchmarkStore()

onMounted(async () => {
  // Load stored results if store is empty (direct navigation to /report)
  if (benchmark.results.length === 0) {
    try {
      const stored = await window.benchmarkAPI.getStoredResults()
      if (stored && stored.length > 0) benchmark.setResults(stored)
    } catch { /* not in Electron */ }
  }
})

const hasResults = computed(() => benchmark.results.length > 0)

const radarOption = computed(() => {
  const indicators = [
    { name: 'CPU', max: 10000 },
    { name: 'Memory', max: 10000 },
    { name: 'Disk', max: 10000 },
    { name: 'GPU', max: 10000 },
    { name: 'Graphics', max: 10000 },
  ]
  const values = indicators.map((ind) => {
    const r = benchmark.resultMap[ind.name.toLowerCase()]
    return r ? r.score : 0
  })
  return {
    radar: {
      indicator: indicators,
      center: ['50%', '50%'],
      radius: '70%',
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: values,
            name: t('report.overallScore') as string,
            areaStyle: { color: 'rgba(37, 99, 235, 0.15)' },
            lineStyle: { color: '#2563eb', width: 2 },
            itemStyle: { color: '#2563eb' },
          },
        ],
      },
    ],
  }
})
</script>

<template>
  <div>
    <h2 class="page-title">📊 {{ $t('report.title') }}</h2>
    <p class="page-subtitle">{{ $t('report.radarChart') }}</p>

    <div v-if="!hasResults" class="bench-card text-center text-gray-400 py-16">
      <div class="text-5xl mb-4">📊</div>
      <p>{{ $t('report.noData') }}</p>
    </div>

    <div v-else>
      <div class="mb-6">
        <ScoreCard :score="benchmark.overallScore" :label="$t('report.overallScore')" :show-tier="true" size="large" />
      </div>

      <div class="bench-card mb-6">
        <VChart :option="radarOption" style="height: 400px" autoresize />
      </div>

      <div class="grid grid-cols-3 gap-4 mb-6">
        <ScoreCard
          v-if="benchmark.resultMap['cpu']"
          :score="benchmark.resultMap['cpu'].score"
          label="CPU"
          :show-tier="true"
        />
        <ScoreCard
          v-if="benchmark.resultMap['memory']"
          :score="benchmark.resultMap['memory'].score"
          label="Memory"
          :show-tier="true"
        />
        <ScoreCard
          v-if="benchmark.resultMap['disk']"
          :score="benchmark.resultMap['disk'].score"
          label="Disk"
          :show-tier="true"
        />
        <ScoreCard
          v-if="benchmark.resultMap['gpu']"
          :score="benchmark.resultMap['gpu'].score"
          label="GPU"
          :show-tier="true"
        />
        <ScoreCard
          v-if="benchmark.resultMap['graphics']"
          :score="benchmark.resultMap['graphics'].score"
          label="Graphics"
          :show-tier="true"
        />
      </div>
    </div>
  </div>
</template>
