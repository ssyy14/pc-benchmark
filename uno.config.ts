import { defineConfig, presetUno } from 'unocss'

export default defineConfig({
  presets: [presetUno()],
  shortcuts: {
    'score-text': 'text-4xl font-bold text-[#2563eb]',
    'tier-badge': 'inline-block px-3 py-1 rounded-full text-sm font-semibold text-white',
    'bench-card': 'bg-white rounded-lg shadow-sm border border-gray-100 p-6',
    'page-title': 'text-2xl font-bold text-gray-900 mb-2',
    'page-subtitle': 'text-sm text-gray-500 mb-6',
  },
})
