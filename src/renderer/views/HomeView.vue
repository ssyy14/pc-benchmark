<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useBenchmarkStore } from '../stores/benchmark'
import SystemInfoComponent from '../components/SystemInfo.vue'
import ScoreCard from '../components/ScoreCard.vue'
import type { SystemInfo } from '../utils/system-info'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const router = useRouter()
const benchmark = useBenchmarkStore()

const info = ref<SystemInfo | null>(null)
const infoLoading = ref(true)
const runningAll = ref(false)

onMounted(async () => {
  try {
    info.value = await window.benchmarkAPI.getSystemInfo()
  } catch (e) {
    console.error('Failed to get system info:', e)
  } finally {
    infoLoading.value = false
  }
})

async function runAll() {
  runningAll.value = true
  benchmark.isRunning = true
  benchmark.runningType = 'all'

  try {
    const results = await window.benchmarkAPI.runAllBenchmarks()
    benchmark.setResults(results)
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

    <SystemInfoComponent :info="info" :loading="infoLoading" />

    <div v-if="benchmark.overallScore > 0" class="mt-6">
      <ScoreCard :score="benchmark.overallScore" :label="t('report.overallScore')" :show-tier="true" size="large" />
    </div>
  </div>
</template>
