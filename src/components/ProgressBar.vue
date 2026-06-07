<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    progress: number
    phase: string
    status?: 'idle' | 'running' | 'completed' | 'skipped'
  }>(),
  { status: 'running' }
)

const colorClass = computed(() => {
  switch (props.status) {
    case 'completed':
      return 'bg-green-500'
    case 'running':
      return 'bg-blue-500'
    case 'skipped':
      return 'bg-gray-300'
    default:
      return 'bg-gray-200'
  }
})
</script>

<template>
  <div class="w-full">
    <div class="flex justify-between items-center mb-1.5">
      <span class="text-sm text-gray-600">{{ phase }}</span>
      <span class="text-sm text-gray-400">{{ Math.round(progress) }}%</span>
    </div>
    <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        :class="colorClass"
        class="h-full rounded-full transition-all duration-300 ease-out"
        :style="{ width: `${progress}%` }"
      />
    </div>
  </div>
</template>
