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
  const matC = new Float64Array(N * M)
  const fftN = 16384
  const fftReal = new Float64Array(fftN), fftImag = new Float64Array(fftN)

  while (Date.now() < endTime) {
    // 1. 200x200 double-precision matrix multiply (accumulating)
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < M; k++) {
        const aik = i * 1.1 * k * 0.7 + (i + k) * 0.004
        for (let j = 0; j < M; j++) {
          const bkj = j * 0.9 + k * 1.2 + 0.005
          matC[i * M + j] += aik * bkj
        }
      }
    }

    // 2. In-place FFT on 16384 complex samples
    for (let i = 0; i < fftN; i++) {
      let rev = 0
      for (let b = 0; b < 14; b++) if (i & (1 << b)) rev |= (1 << (13 - b))
      if (i < rev) {
        [fftReal[i], fftReal[rev]] = [fftReal[rev], fftReal[i]]
        ;[fftImag[i], fftImag[rev]] = [fftImag[rev], fftImag[i]]
      }
    }
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

    if (ph.metric === 'cryptoMBps') {
      // Each crypto op processes ~512KB data
      metrics[ph.metric] = Math.round((totalOps * 512 * 1024) / (1024 * 1024) / elapsed)
    } else {
      metrics[ph.metric] = Math.round((totalOps * 100) / elapsed) / 100
    }

    postProgress(
      `${ph.icon} ${ph.name}: ${Math.round(metrics[ph.metric]).toLocaleString()} ${ph.metric}`,
      phaseStartPct[i] + 25,
      metrics,
    )
  }

  const duration = Math.round(performance.now() - t0)
  postProgress('Complete', 100, metrics)

  parentPort?.postMessage({
    type: 'cpu', phase: 'complete', progress: 100, done: true,
    metrics: {
      intMOps: Math.round(metrics.intMOps),
      fpMOps: Math.round(metrics.fpMOps),
      cryptoMBps: Math.round(metrics.cryptoMBps),
      mixedMOps: Math.round(metrics.mixedMOps),
      duration,
    },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
