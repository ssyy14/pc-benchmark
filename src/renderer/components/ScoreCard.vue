<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    score: number
    label: string
    showTier?: boolean
    size?: 'small' | 'large'
  }>(),
  { showTier: false, size: 'small' }
)

const { locale } = useI18n()

interface TierInfo {
  tier: number
  emoji: string
  color: string
  label: string
}

function getTier(s: number): TierInfo {
  const labelMap: Record<number, Record<string, string>> = {
    1: { 'zh-CN': '入门', 'en-US': 'Entry' },
    2: { 'zh-CN': '主流', 'en-US': 'Mainstream' },
    3: { 'zh-CN': '高性能', 'en-US': 'High-Perf' },
    4: { 'zh-CN': '旗舰', 'en-US': 'Flagship' },
    5: { 'zh-CN': '发烧级', 'en-US': 'Enthusiast' },
  }
  if (s >= 8500) return { tier: 5, emoji: '👑', color: '#dc2626', label: labelMap[5][locale.value] || 'Enthusiast' }
  if (s >= 6500) return { tier: 4, emoji: '💎', color: '#7c3aed', label: labelMap[4][locale.value] || 'Flagship' }
  if (s >= 4000) return { tier: 3, emoji: '🥇', color: '#2563eb', label: labelMap[3][locale.value] || 'High-Perf' }
  if (s >= 2000) return { tier: 2, emoji: '🥈', color: '#16a34a', label: labelMap[2][locale.value] || 'Mainstream' }
  return { tier: 1, emoji: '🥉', color: '#6b7280', label: labelMap[1][locale.value] || 'Entry' }
}

const tier = computed(() => (props.showTier && props.score > 0 ? getTier(props.score) : null))

const scoreClass = computed(() => (props.size === 'large' ? 'text-6xl' : 'text-4xl'))
</script>

<template>
  <div class="bench-card text-center">
    <div class="text-sm text-gray-500 mb-2">{{ label }}</div>
    <div :class="scoreClass" class="font-bold text-[#2563eb] mb-2">
      {{ score > 0 ? score.toLocaleString() : '--' }}
    </div>
    <div
      v-if="tier"
      class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-white text-sm font-medium"
      :style="{ backgroundColor: tier.color }"
    >
      <span>{{ tier.emoji }}</span>
      <span>{{ tier.label }}</span>
    </div>
  </div>
</template>
