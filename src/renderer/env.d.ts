/// <reference types="vite/client" />

import type { BenchmarkAPI } from '../electron/bridge'

declare global {
  interface Window {
    benchmarkAPI: BenchmarkAPI
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
