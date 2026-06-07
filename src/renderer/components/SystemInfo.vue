<script setup lang="ts">
import type { SystemInfo } from '../utils/system-info'

defineProps<{
  info: SystemInfo | null
  loading: boolean
}>()
</script>

<template>
  <div class="bench-card">
    <div v-if="loading" class="text-center text-gray-400 py-8">Loading system information...</div>
    <div v-else-if="!info" class="text-center text-gray-400 py-8">Unable to detect system information</div>
    <div v-else class="grid grid-cols-2 gap-4">
      <div>
        <div class="text-xs text-gray-400 mb-1">{{ $t('home.cpuModel') }}</div>
        <div class="text-sm font-medium text-gray-800 truncate" :title="info.cpuModel">{{ info.cpuModel }}</div>
      </div>
      <div>
        <div class="text-xs text-gray-400 mb-1">{{ $t('home.cpuCores') }}</div>
        <div class="text-sm font-medium text-gray-800">{{ info.cpuCores }} Cores / {{ info.cpuThreads }} Threads</div>
      </div>
      <div>
        <div class="text-xs text-gray-400 mb-1">{{ $t('home.totalMemory') }}</div>
        <div class="text-sm font-medium text-gray-800">{{ info.totalMemoryGB }} GB</div>
      </div>
      <div>
        <div class="text-xs text-gray-400 mb-1">{{ $t('home.osName') }}</div>
        <div class="text-sm font-medium text-gray-800">{{ info.osName }} {{ info.osVersion }}</div>
      </div>
      <div class="col-span-2">
        <div class="text-xs text-gray-400 mb-1">{{ $t('home.gpuModel') }}</div>
        <div class="text-sm font-medium text-gray-800 truncate" :title="info.gpuModel">{{ info.gpuModel }}</div>
      </div>
    </div>
  </div>
</template>
