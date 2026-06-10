# CPU 4-Phase Multi-Core Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-phase CPU benchmark (single-core + multi-core + crypto) with a 4-phase all-core pressure test (integer, float, crypto, mixed) totaling ~25 seconds. All phases run `os.cpus().length` workers concurrently.

**Architecture:** The `cpu-worker.ts` main thread spawns N workers per phase, each worker runs phase-specific heavy operations for the phase duration. The main thread aggregates results and posts progress. Scoring is updated to weight 4 metrics equally. The Vue component adds phase dots and per-phase metric cards matching the GPU benchmark UI style.

**Tech Stack:** Node.js worker_threads, crypto, zlib, TypeScript, Vue 3, Vitest

---

### Task 1: Update `calculateCpuScore` for 4-phase metrics

**Files:**
- Modify: `src/renderer/utils/scoring.ts:42-48`
- Modify: `src/renderer/utils/__tests__/scoring.test.ts`

- [ ] **Step 1: Add CPU score tests**

Add after the existing `calculateCpuScore` describe block in `scoring.test.ts`:

```ts
describe('calculateCpuScore', () => {
  it('returns around 5000 for reference-level 4-phase CPU', () => {
    const score = calculateCpuScore({
      intMOps: 50000,
      fpMOps: 30000,
      cryptoMBps: 5000,
      mixedMOps: 20000,
    })
    expect(score).toBeGreaterThan(4000)
    expect(score).toBeLessThan(6000)
  })

  it('handles zero metrics gracefully', () => {
    const score = calculateCpuScore({
      intMOps: 0,
      fpMOps: 0,
      cryptoMBps: 0,
      mixedMOps: 0,
    })
    expect(score).toBe(0)
  })

  // Backward compatibility: old format still works
  it('falls back to old format if new metrics missing', () => {
    const score = calculateCpuScore({
      singleCoreMOps: 5000,
      multiCoreMOps: 20000,
      cryptoMBps: 2000,
    })
    expect(score).toBeGreaterThan(4000)
    expect(score).toBeLessThan(6000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd C:/Users/r/pc-benchmark && npm run test -- src/renderer/utils/__tests__/scoring.test.ts
```

Expected: New 4-phase CPU tests FAIL (score 0).

- [ ] **Step 3: Rewrite `calculateCpuScore`**

Replace lines 42-48 of `scoring.ts`:

```ts
export function calculateCpuScore(metrics: Record<string, number>): number {
  // New 4-phase all-core metrics
  if (metrics.intMOps !== undefined || metrics.fpMOps !== undefined
    || (metrics.cryptoMBps !== undefined && !metrics.singleCoreMOps)
    || metrics.mixedMOps !== undefined) {

    const intScore = normalizeScore(metrics.intMOps || 0, 50_000)
    const fpScore  = normalizeScore(metrics.fpMOps || 0, 30_000)
    const crypto   = normalizeScore(metrics.cryptoMBps || 0, 5_000)
    const mixed    = normalizeScore(metrics.mixedMOps || 0, 20_000)

    return Math.round(
      intScore * 0.25 +
      fpScore  * 0.25 +
      crypto   * 0.25 +
      mixed    * 0.25
    )
  }

  // Legacy fallback: old single/multi-core format
  const ref = REFERENCES.cpu
  const single = normalizeScore(metrics.singleCoreMOps || 0, ref.singleCoreMOps)
  const multi  = normalizeScore(metrics.multiCoreMOps || 0, ref.multiCoreMOps)
  const crypto = normalizeScore(metrics.cryptoMBps || 0, ref.cryptoMBps)
  return Math.round(single * 0.25 + multi * 0.55 + crypto * 0.2)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd C:/Users/r/pc-benchmark && npm run test -- src/renderer/utils/__tests__/scoring.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/utils/scoring.ts src/renderer/utils/__tests__/scoring.test.ts
git commit -m "feat: update calculateCpuScore for 4-phase all-core metrics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Rewrite CPU Worker — Phase Templates + Runner

**Files:**
- Modify: `electron/workers/cpu-worker.ts`

- [ ] **Step 1: Replace cpu-worker.ts with 4-phase rewrite**

Replace the entire file:

```ts
import { parentPort, Worker } from 'worker_threads'
import crypto from 'crypto'
import zlib from 'zlib'
import os from 'os'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'cpu', phase, progress, metrics })
}

// ─── Phase 1: Integer Worker Code ────────────────────────
const SUB_INT = `
const { parentPort } = require('worker_threads')
parentPort.on('message', (durationMs) => {
  const endTime = Date.now() + durationMs
  let ops = 0
  const sieveBuf = new Uint8Array(50_000_001)

  while (Date.now() < endTime) {
    // 1. Prime sieve 50M range
    const limit = 50_000_000
    sieveBuf.fill(1); sieveBuf[0] = sieveBuf[1] = 0
    for (let i = 2; i * i <= limit; i++) {
      if (sieveBuf[i]) for (let j = i * i; j <= limit; j += i) sieveBuf[j] = 0
    }

    // 2. Bit rotation / XOR storm
    let bits1 = 0xDEADBEEF, bits2 = 0xCAFEBABE
    for (let i = 0; i < 2_000_000; i++) {
      bits1 = ((bits1 << 7) | (bits1 >>> 25)) ^ (bits1 * 1103515245)
      bits2 = (bits2 >>> 3) ^ (bits2 << 17) ^ bits1
    }

    // 3. Integer division/modulo storm
    let divAcc = 0
    for (let i = 1; i <= 100_000; i++) {
      divAcc += Math.floor(bits1 / i) + (bits1 % (i + 1)) + Math.floor(bits2 / (i * 3 + 1))
    }
    ops++
  }
  parentPort.postMessage(ops)
  process.exit(0)
})
`

// ─── Phase 2: Float Worker Code ──────────────────────────
const SUB_FP = `
const { parentPort } = require('worker_threads')
parentPort.on('message', (durationMs) => {
  const endTime = Date.now() + durationMs
  let ops = 0
  const N = 200, M = 200
  const matA = new Float64Array(N * M), matB = new Float64Array(N * M), matC = new Float64Array(N * M)
  const fftN = 16384
  const fftReal = new Float64Array(fftN), fftImag = new Float64Array(fftN)

  while (Date.now() < endTime) {
    // 1. 200x200 double-precision matrix multiply
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < M; k++) {
        const aik = i * 1.1 * k * 0.7 + (i + k) * 0.004
        for (let j = 0; j < M; j++) {
          const bkj = j * 0.9 + k * 1.2 + 0.005
          matC[i * M + j] += aik * bkj
        }
      }
    }

    // 2. In-place FFT on 16384 complex samples (reduced radix-2 impl)
    // Bit-reversal permutation
    for (let i = 0; i < fftN; i++) {
      let rev = 0
      for (let b = 0; b < 14; b++) if (i & (1 << b)) rev |= (1 << (13 - b))
      if (i < rev) {
        [fftReal[i], fftReal[rev]] = [fftReal[rev], fftReal[i]]
        ;[fftImag[i], fftImag[rev]] = [fftImag[rev], fftImag[i]]
      }
    }
    // FFT butterfly
    for (let len = 2; len <= fftN; len *= 2) {
      const half = len / 2
      const ang = -2 * Math.PI / len
      for (let i = 0; i < fftN; i += len) {
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half
          const wr = Math.cos(ang * j), wi = Math.sin(ang * j)
          const tr = fftReal[b] * wr - fftImag[b] * wi
          const ti = fftReal[b] * wi + fftImag[b] * wr
          fftReal[b] = fftReal[a] - tr; fftImag[b] = fftImag[a] - ti
          fftReal[a] += tr; fftImag[a] += ti
        }
      }
    }

    // 3. Trig storm
    let trigAcc = 0
    for (let i = 0; i < 200_000; i++) {
      trigAcc += Math.sin(i * 0.001) * Math.cos(i * 0.0007) + Math.exp(Math.sin(i * 0.0003))
    }
    ops++
  }
  parentPort.postMessage(ops)
  process.exit(0)
})
`

// ─── Phase 3: Crypto Worker Code ─────────────────────────
const SUB_CRYPTO = `
const { parentPort } = require('worker_threads')
const crypto = require('crypto')
parentPort.on('message', (durationMs) => {
  const endTime = Date.now() + durationMs
  let ops = 0
  const data = Buffer.alloc(512 * 1024)
  const key = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const pbkdf2Password = 'benchmark-password-2024'
  const pbkdf2Salt = crypto.randomBytes(32)

  while (Date.now() < endTime) {
    // 1. AES-256-GCM encrypt + decrypt
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()])
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(enc.slice(enc.length - 16))
    decipher.update(enc.slice(0, enc.length - 16)); decipher.final()

    // 2. SHA-512
    crypto.createHash('sha512').update(data).digest('hex')

    // 3. PBKDF2 key derivation
    crypto.pbkdf2Sync(pbkdf2Password, pbkdf2Salt, 10000, 64, 'sha512')
    ops++
  }
  parentPort.postMessage(ops)
  process.exit(0)
})
`

// ─── Phase 4: Mixed Worker Code ──────────────────────────
const SUB_MIXED = `
const { parentPort } = require('worker_threads')
const crypto = require('crypto')
const zlib = require('zlib')
parentPort.on('message', (durationMs) => {
  const endTime = Date.now() + durationMs
  let ops = 0
  const sieveBuf = new Uint8Array(10_000_001)
  const mat = new Float64Array(100 * 100)
  const data = Buffer.alloc(256 * 1024)
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(16)

  while (Date.now() < endTime) {
    // 1. Integer (small sieve)
    const limit = 10_000_000
    sieveBuf.fill(1); sieveBuf[0] = sieveBuf[1] = 0
    for (let i = 2; i * i <= limit; i++) {
      if (sieveBuf[i]) for (let j = i * i; j <= limit; j += i) sieveBuf[j] = 0
    }
    // 2. Float (small matrix)
    for (let i = 0; i < 100; i++) for (let k = 0; k < 100; k++) {
      for (let j = 0; j < 100; j++) mat[i*100+j] += (i*1.1) * (j*0.9)
    }
    // 3. AES encrypt
    const c = crypto.createCipheriv('aes-256-gcm', key, iv)
    Buffer.concat([c.update(data), c.final()])
    // 4. SHA-512
    crypto.createHash('sha512').update(data).digest('hex')
    // 5. Zlib compress + decompress
    zlib.deflateSync(data); zlib.inflateSync(data)
    ops++
  }
  parentPort.postMessage(ops)
  process.exit(0)
})
`

// ─── Phase Runner ────────────────────────────────────────
function runPhaseWorkers(label: string, code: string, durationMs: number): Promise<number> {
  return new Promise((resolve) => {
    const cores = os.cpus().length
    const workers: Worker[] = []
    const promises: Promise<number>[] = []
    for (let i = 0; i < cores; i++) {
      const w = new Worker(code, { eval: true })
      workers.push(w)
      promises.push(new Promise<number>(r => { w.on('message', r); w.on('error', () => r(0)) }))
      w.postMessage(durationMs)
    }
    Promise.all(promises).then(results => {
      resolve(results.reduce((a, b) => a + b, 0))
    })
  })
}

// ─── Main ────────────────────────────────────────────────
async function run(): Promise<void> {
  const t0 = performance.now()
  const cores = os.cpus().length
  const phases: Array<{ name: string; icon: string; code: string; duration: number; metric: string }> = [
    { name: 'Integer',  icon: '🔴', code: SUB_INT,    duration: 6000, metric: 'intMOps' },
    { name: 'Float',    icon: '🟡', code: SUB_FP,     duration: 7000, metric: 'fpMOps' },
    { name: 'Crypto',   icon: '🟢', code: SUB_CRYPTO, duration: 6000, metric: 'cryptoMBps' },
    { name: 'Mixed',    icon: '🔵', code: SUB_MIXED,  duration: 6000, metric: 'mixedMOps' },
  ]

  const metrics: Record<string, number> = {}
  const phaseStartPct = [0, 25, 50, 75]

  for (let i = 0; i < phases.length; i++) {
    const ph = phases[i]
    postProgress(`${ph.icon} Phase ${i + 1}/4: ${ph.name} · ${cores} threads`, phaseStartPct[i])

    const phaseStart = performance.now()
    const totalOps = await runPhaseWorkers(ph.name, ph.code, ph.duration)
    const elapsed = (performance.now() - phaseStart) / 1000

    const value = Math.round(totalOps / elapsed * 100) / 100
    metrics[ph.metric] = value
    // For crypto phase, report as MB/s based on data volume
    if (ph.metric === 'cryptoMBps') {
      // Each crypto op processes ~512KB data
      metrics[ph.metric] = Math.round((totalOps * 512 * 1024) / (1024 * 1024) / elapsed)
    }

    postProgress(`${ph.icon} ${ph.name}: ${Math.round(metrics[ph.metric]).toLocaleString()} ${ph.metric}`, phaseStartPct[i] + 25, metrics)
  }

  postProgress('Complete', 100, metrics)

  parentPort?.postMessage({
    type: 'cpu', phase: 'complete', progress: 100, done: true,
    metrics: {
      intMOps: Math.round(metrics.intMOps),
      fpMOps: Math.round(metrics.fpMOps),
      cryptoMBps: Math.round(metrics.cryptoMBps),
      mixedMOps: Math.round(metrics.mixedMOps),
      duration: Math.round(performance.now() - t0),
    },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
```

- [ ] **Step 2: Verify type check**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | grep -i "cpu-worker" || echo "NO_CPU_WORKER_ERRORS"
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add electron/workers/cpu-worker.ts
git commit -m "feat: rewrite CPU worker with 4-phase all-core pressure test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Update CPU Benchmark UI

**Files:**
- Modify: `src/renderer/views/CpuBenchmark.vue`

- [ ] **Step 1: Replace CpuBenchmark.vue**

```vue
<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore, type BenchmarkProgress } from '../stores/benchmark'
import { calculateCpuScore } from '../utils/scoring'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()

const isRunning = ref(false)
const progress = ref<BenchmarkProgress | null>(null)
const currentPhase = ref(0)
const result = computed(() => benchmark.resultMap['cpu'])

const phaseNames = ['Integer', 'Float', 'Crypto', 'Mixed']
const phaseIcons = ['🔴', '🟡', '🟢', '🔵']

function handleProgress(p: BenchmarkProgress) {
  if (p.type === 'cpu') {
    progress.value = p
    // Detect phase from icon prefix
    const icon = p.phase?.charAt(0)
    if (icon === '🔴') currentPhase.value = 0
    else if (icon === '🟡') currentPhase.value = 1
    else if (icon === '🟢') currentPhase.value = 2
    else if (icon === '🔵') currentPhase.value = 3
  }
}

async function start() {
  isRunning.value = true
  currentPhase.value = 0
  benchmark.isRunning = true
  benchmark.runningType = 'cpu'
  window.benchmarkAPI.onProgress(handleProgress)
  try {
    const r = await window.benchmarkAPI.runBenchmark('cpu')
    const score = calculateCpuScore(r.metrics)
    benchmark.setResult({ ...r, score })
  } catch (e) {
    console.error('CPU benchmark failed:', e)
  } finally {
    isRunning.value = false
    benchmark.isRunning = false
    benchmark.runningType = null
    window.benchmarkAPI.removeProgressListener()
    currentPhase.value = -1
  }
}

onUnmounted(() => {
  window.benchmarkAPI?.removeProgressListener()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">⚡ {{ $t('nav.cpu') }}</h2>
        <p class="page-subtitle">4-phase all-core pressure test — integer, float, crypto, mixed</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <div v-if="isRunning && progress" class="bench-card mb-6">
      <!-- Phase dots indicator -->
      <div class="flex items-center justify-center gap-3 mb-3">
        <div v-for="(name, idx) in phaseNames" :key="name" class="flex items-center gap-1.5">
          <div
            class="w-3 h-3 rounded-full transition-all duration-300"
            :class="{
              'bg-blue-500 scale-125 shadow-lg shadow-blue-500/50': idx === currentPhase,
              'bg-green-500': idx < currentPhase,
              'bg-gray-600': idx !== currentPhase && !(idx < currentPhase),
            }"
          />
          <span class="text-xs" :class="idx === currentPhase ? 'text-blue-400 font-semibold' : 'text-gray-500'">{{ name }}</span>
        </div>
      </div>

      <ProgressBar :progress="progress.progress" :phase="progress.phase" status="running" />

      <!-- Live per-phase metrics -->
      <div v-if="progress.metrics" class="grid grid-cols-4 gap-3 mt-4 text-center">
        <div v-if="progress.metrics.intMOps">
          <div class="text-lg font-bold text-red-400">{{ (progress.metrics.intMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">Int MOps/s</div>
        </div>
        <div v-if="progress.metrics.fpMOps">
          <div class="text-lg font-bold text-yellow-400">{{ (progress.metrics.fpMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">FP MOps/s</div>
        </div>
        <div v-if="progress.metrics.cryptoMBps">
          <div class="text-lg font-bold text-green-400">{{ progress.metrics.cryptoMBps }}</div>
          <div class="text-xs text-gray-500">Crypto MB/s</div>
        </div>
        <div v-if="progress.metrics.mixedMOps">
          <div class="text-lg font-bold text-blue-400">{{ (progress.metrics.mixedMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">Mixed MOps/s</div>
        </div>
      </div>
    </div>

    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />

      <div class="grid grid-cols-2 gap-3 mt-4">
        <div v-if="result.metrics.intMOps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔴 Integer</div>
          <div class="text-xl font-bold text-red-400">{{ (result.metrics.intMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">MOps/s</div>
        </div>
        <div v-if="result.metrics.fpMOps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟡 Float</div>
          <div class="text-xl font-bold text-yellow-400">{{ (result.metrics.fpMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">MOps/s</div>
        </div>
        <div v-if="result.metrics.cryptoMBps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟢 Crypto</div>
          <div class="text-xl font-bold text-green-400">{{ result.metrics.cryptoMBps }}</div>
          <div class="text-xs text-gray-500">MB/s</div>
        </div>
        <div v-if="result.metrics.mixedMOps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔵 Mixed</div>
          <div class="text-xl font-bold text-blue-400">{{ (result.metrics.mixedMOps / 1000).toFixed(1) }}K</div>
          <div class="text-xs text-gray-500">MOps/s</div>
        </div>
      </div>

      <div class="text-center text-sm text-gray-400 mt-2">
        {{ $t('benchmark.duration') }}: {{ (result.duration / 1000).toFixed(1) }}{{ $t('common.seconds') }}
      </div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">⚡</div>
      <p>{{ $t('benchmark.notRun') }}</p>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify type check**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | grep -i "CpuBenchmark" || echo "NO_CPU_UI_ERRORS"
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/views/CpuBenchmark.vue
git commit -m "feat: update CPU benchmark UI with phase dots and per-phase metrics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Integration Verification

- [ ] **Step 1: Run full test suite**

```bash
cd C:/Users/r/pc-benchmark && npm run test
```

Expected: All tests pass.

- [ ] **Step 2: Full type check**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Build**

```bash
cd C:/Users/r/pc-benchmark && npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Launch dev mode for visual verification**

```bash
cd C:/Users/r/pc-benchmark && npm run dev
```

Manual checklist:
- [ ] Home page shows correct CPU core count
- [ ] CPU test page shows 4 phase dots during test
- [ ] Live metrics update during each phase
- [ ] Per-phase results display after test
- [ ] Overall CPU score shows
- [ ] GPU test still works (no regression)

- [ ] **Step 5: Commit fixes, push**

```bash
cd C:/Users/r/pc-benchmark
git add -A
git commit -m "chore: integration fixes after CPU benchmark verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin master
```

---

## Summary

| Task | Files | What |
|---|---|---|
| 1 | `scoring.ts`, test | 4-metric CPU scoring + backward compat |
| 2 | `cpu-worker.ts` | 4-phase all-core worker rewrite |
| 3 | `CpuBenchmark.vue` | Phase dots + per-phase metrics UI |
| 4 | all | Type check, build, visual verification |
