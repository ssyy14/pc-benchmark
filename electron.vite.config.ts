import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main.ts'),
          'workers/cpu-worker': resolve(__dirname, 'electron/workers/cpu-worker.ts'),
          'workers/memory-worker': resolve(__dirname, 'electron/workers/memory-worker.ts'),
          'workers/disk-worker': resolve(__dirname, 'electron/workers/disk-worker.ts'),
          'workers/gpu-worker': resolve(__dirname, 'electron/workers/gpu-worker.ts'),
          'workers/graphics-worker': resolve(__dirname, 'electron/workers/graphics-worker.ts'),
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    plugins: [vue(), UnoCSS()]
  }
})
