<script setup lang="ts">
import AppSidebar from './components/AppSidebar.vue'
import { useSettingsStore } from './stores/settings'
import { useI18n } from 'vue-i18n'
import { watch } from 'vue'
import { NConfigProvider } from 'naive-ui'

const settings = useSettingsStore()
const { locale } = useI18n()

watch(
  () => settings.locale,
  (newLocale) => {
    locale.value = newLocale
  }
)
</script>

<template>
  <NConfigProvider>
    <div class="flex h-screen bg-[#f8fafc] overflow-hidden">
      <AppSidebar />
      <main class="flex-1 overflow-y-auto">
        <div class="max-w-4xl mx-auto px-8 py-6">
          <router-view />
        </div>
      </main>
    </div>
  </NConfigProvider>
</template>
