import { parentPort, Worker } from 'worker_threads'
import crypto from 'crypto'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'cpu', phase, progress, metrics })
}

// --- Single-core tests ---

function primeSieve(limit: number): number {
  const sieve = new Uint8Array(limit + 1).fill(1)
  sieve[0] = sieve[1] = 0
  for (let i = 2; i * i <= limit; i++) {
    if (sieve[i]) {
      for (let j = i * i; j <= limit; j += i) sieve[j] = 0
    }
  }
  let count = 0
  for (let i = 2; i <= limit; i++) if (sieve[i]) count++
  return count
}

function computePi(iterations: number): number {
  let pi = 0, sign = 1
  for (let i = 0; i < iterations; i++) {
    pi += sign / (2 * i + 1)
    sign = -sign
  }
  return pi * 4
}

function cryptoBenchmark(durationMs: number): number {
  const data = Buffer.alloc(1024 * 64)
  const key = crypto.randomBytes(32)
  const iv = crypto.randomBytes(16)
  const start = Date.now()
  let totalBytes = 0
  while (Date.now() - start < durationMs) {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    cipher.update(data)
    cipher.final()
    totalBytes += data.length
  }
  return totalBytes / (1024 * 1024) / (durationMs / 1000)
}

// --- True multi-core: spawn sub-workers ---

function runSubWorker(chunk: number): Promise<number> {
  // Each sub-worker runs primeSieve on its chunk in a REAL separate thread
  const code = `
    const { parentPort } = require('worker_threads')
    parentPort.on('message', (limit) => {
      const sieve = new Uint8Array(limit + 1).fill(1)
      sieve[0] = sieve[1] = 0
      for (let i = 2; i * i <= limit; i++) {
        if (sieve[i]) for (let j = i * i; j <= limit; j += i) sieve[j] = 0
      }
      let count = 0
      for (let i = 2; i <= limit; i++) if (sieve[i]) count++
      parentPort.postMessage(count)
      process.exit(0)
    })
  `
  return new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true })
    w.on('message', (count: number) => resolve(count))
    w.on('error', reject)
    w.postMessage(chunk)
  })
}

async function runMultiCore(cores: number): Promise<number> {
  const totalRange = 30_000_000
  const chunkSize = Math.floor(totalRange / cores)

  const start = performance.now()
  const tasks: Promise<number>[] = []
  for (let i = 0; i < cores; i++) {
    tasks.push(runSubWorker(chunkSize))
  }
  const results = await Promise.all(tasks)
  const elapsed = performance.now() - start
  const totalOps = chunkSize * cores
  // MOps/s = millions of numbers processed per second
  return totalOps / (elapsed / 1000) / 1_000_000
}

async function run(): Promise<void> {
  const os = await import('os')
  const cores = os.cpus().length

  // Phase 1: Single-core integer
  postProgress('Single-core integer (prime sieve)', 10)
  const t0 = performance.now()
  primeSieve(10_000_000)
  const singleCoreMOps = 10_000_000 / ((performance.now() - t0) / 1000) / 1_000_000
  postProgress('Single-core integer', 20, { singleCoreMOps })

  // Phase 2: Single-core float
  postProgress('Single-core floating-point (π)', 25)
  computePi(200_000_000)
  postProgress('Single-core floating-point', 35)

  // Phase 3: True multi-core via sub-workers
  postProgress(`Multi-core (${cores} threads)`, 40)
  const multiCoreMOps = await runMultiCore(cores)
  postProgress('Multi-core parallel', 75, { singleCoreMOps, multiCoreMOps })

  // Phase 4: Crypto
  postProgress('Crypto throughput (AES-256)', 80)
  const cryptoMBps = cryptoBenchmark(3000)
  postProgress('Crypto throughput', 100, { singleCoreMOps, multiCoreMOps, cryptoMBps })

  parentPort?.postMessage({
    type: 'cpu', phase: 'complete', progress: 100, done: true,
    metrics: {
      singleCoreMOps: Math.round(singleCoreMOps * 100) / 100,
      multiCoreMOps: Math.round(multiCoreMOps * 100) / 100,
      cryptoMBps: Math.round(cryptoMBps),
      duration: Math.round(performance.now() - t0),
    },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
