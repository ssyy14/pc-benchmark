import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  const locale = ref<'zh-CN' | 'en-US'>('zh-CN')

  function toggleLocale() {
    locale.value = locale.value === 'zh-CN' ? 'en-US' : 'zh-CN'
  }

  return { locale, toggleLocale }
})
