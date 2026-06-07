import { parentPort, Worker } from 'worker_threads'
import crypto from 'crypto'
import os from 'os'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'cpu', phase, progress, metrics })
}

const SUB_CODE = `
const { parentPort } = require('worker_threads')
const crypto = require('crypto')

parentPort.on('message', (durationMs) => {
  const endTime = Date.now() + durationMs
  let ops = 0

  // Pre-allocate all working buffers
  const sieveBuf = new Uint8Array(2_500_001)
  const mandelW = 120, mandelH = 90, maxIter = 256
  const matSize = 80
  const matA = new Float64Array(matSize * matSize)
  const matB = new Float64Array(matSize * matSize)
  const matC = new Float64Array(matSize * matSize)
  for (let i = 0; i < matSize * matSize; i++) { matA[i] = Math.random(); matB[i] = Math.random() }

  // SHA buffer
  const hashData = Buffer.alloc(256 * 1024)

  while (Date.now() < endTime) {
    // 1. Prime sieve (2.5M range)
    const limit = 2_500_000
    sieveBuf.fill(1)
    sieveBuf[0] = sieveBuf[1] = 0
    for (let i = 2; i * i <= limit; i++) {
      if (sieveBuf[i]) for (let j = i * i; j <= limit; j += i) sieveBuf[j] = 0
    }

    // 2. Mandelbrot
    for (let py = 0; py < mandelH; py++) {
      const y0 = (py / mandelH) * 3.5 - 2.0
      for (let px = 0; px < mandelW; px++) {
        const x0 = (px / mandelW) * 3.5 - 2.5
        let x = 0, y = 0, iter = 0
        while (x * x + y * y <= 4 && iter < maxIter) {
          const xt = x * x - y * y + x0; y = 2 * x * y + y0; x = xt; iter++
        }
      }
    }

    // 3. Matrix multiply
    for (let i = 0; i < matSize; i++) {
      for (let k = 0; k < matSize; k++) {
        const aik = matA[i * matSize + k]
        for (let j = 0; j < matSize; j++) matC[i * matSize + j] += aik * matB[k * matSize + j]
      }
    }

    // 4. SHA-256
    crypto.createHash('sha256').update(hashData).digest('hex')

    ops++
  }

  parentPort.postMessage(ops)
  process.exit(0)
})
`

async function run(): Promise<void> {
  const cores = os.cpus().length

  // Phase 1: Single-core tests
  postProgress('Single-core warmup', 5)
  const t0 = performance.now()

  // build sub-workers first to preload
  const totalDuration = 8000 // 8 seconds per phase

  // Single-core burn
  postProgress(`Single-core burn · 8s`, 5)
  const scWorker = new Worker(SUB_CODE, { eval: true })
  const scPromise = new Promise<number>(resolve => { scWorker.on('message', resolve); scWorker.on('error', () => resolve(0)) })
  scWorker.postMessage(totalDuration)
  const scOps = await scPromise
  const singleCoreMOps = (scOps * 2.5) / ((performance.now() - t0) / 1000)

  postProgress(`Single-core: ${Math.round(singleCoreMOps)} MOps/s`, 40, { singleCoreMOps })

  // Phase 2: Multi-core continuous burn — ALL cores, full duration
  const t1 = performance.now()
  postProgress(`Multi-core burn · ${cores} threads · ${totalDuration / 1000}s`, 45)

  const mcWorkers: Worker[] = []
  const mcPromises: Promise<number>[] = []
  for (let i = 0; i < cores; i++) {
    const w = new Worker(SUB_CODE, { eval: true })
    mcWorkers.push(w)
    mcPromises.push(new Promise<number>(resolve => { w.on('message', resolve); w.on('error', () => resolve(0)) }))
    w.postMessage(totalDuration)
  }

  const mcOps = await Promise.all(mcPromises)
  const mcTotal = mcOps.reduce((a, b) => a + b, 0)
  const elapsed = (performance.now() - t1) / 1000
  const multiCoreMOps = (mcTotal * 2.5) / elapsed

  postProgress(`Multi-core: ${Math.round(multiCoreMOps)} MOps/s (${cores} threads)`, 85, { singleCoreMOps, multiCoreMOps })

  // Phase 3: Crypto + hash storm combined
  postProgress('Crypto + SHA storm', 90)
  const data = Buffer.alloc(1024 * 64)
  const key = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const hashData = Buffer.alloc(1024 * 1024)
  const cStart = Date.now()
  let totalCrypto = 0, totalHashes = 0
  while (Date.now() - cStart < 5000) {
    const c = crypto.createCipheriv('aes-256-cbc', key, iv)
    c.update(data); c.final(); totalCrypto += data.length
    crypto.createHash('sha256').update(hashData).digest('hex'); totalHashes++
  }
  const cryptoMBps = (totalCrypto / (1024 * 1024)) / 5
  const hashMBps = (totalHashes * 1024 * 1024) / (1024 * 1024) / 5

  postProgress('Complete', 100, { singleCoreMOps, multiCoreMOps, cryptoMBps, hashMBps })

  parentPort?.postMessage({
    type: 'cpu', phase: 'complete', progress: 100, done: true,
    metrics: {
      singleCoreMOps: Math.round(singleCoreMOps * 100) / 100,
      multiCoreMOps: Math.round(multiCoreMOps * 100) / 100,
      cryptoMBps: Math.round(cryptoMBps),
      hashMBps: Math.round(hashMBps),
      duration: Math.round(performance.now() - t0),
    },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
