<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/settings'
import { computed } from 'vue'

const router = useRouter()
const route = useRoute()
const { t } = useI18n()
const settings = useSettingsStore()

const navItems = computed(() => [
  { path: '/', name: 'home', label: t('nav.home'), icon: '🖥️' },
  { path: '/cpu', name: 'cpu', label: t('nav.cpu'), icon: '⚡' },
  { path: '/memory', name: 'memory', label: t('nav.memory'), icon: '🧠' },
  { path: '/disk', name: 'disk', label: t('nav.disk'), icon: '💾' },
  { path: '/gpu', name: 'gpu', label: t('nav.gpu'), icon: '🎮' },
  { path: '/graphics', name: 'graphics', label: t('nav.graphics'), icon: '🖼️' },
  { path: '/report', name: 'report', label: t('nav.report'), icon: '📊' },
])

function navigate(path: string) {
  router.push(path)
}

function isActive(path: string): boolean {
  return route.path === path
}
</script>

<template>
  <aside class="w-[200px] min-w-[200px] bg-white border-r border-gray-200 flex flex-col h-full">
    <div class="px-5 py-5 border-b border-gray-100">
      <h1 class="text-lg font-bold text-gray-900">{{ t('app.title') }}</h1>
      <p class="text-xs text-gray-400 mt-0.5">{{ t('app.subtitle') }}</p>
    </div>

    <nav class="flex-1 py-3">
      <button
        v-for="item in navItems"
        :key="item.path"
        @click="navigate(item.path)"
        class="w-full text-left px-5 py-2.5 flex items-center gap-3 transition-colors text-sm border-r-3"
        :class="
          isActive(item.path)
            ? 'bg-blue-50 text-blue-700 font-medium border-r-blue-600'
            : 'text-gray-600 hover:bg-gray-50 border-r-transparent'
        "
      >
        <span class="text-base w-6 text-center">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="px-4 py-3 border-t border-gray-100">
      <button
        @click="settings.toggleLocale()"
        class="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-1.5 rounded transition-colors"
      >
        🌐 {{ settings.locale === 'zh-CN' ? 'English' : '中文' }}
      </button>
    </div>
  </aside>
</template>
