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
    if (sieve[i]) for (let j = i * i; j <= limit; j += i) sieve[j] = 0
  }
  let count = 0
  for (let i = 2; i <= limit; i++) if (sieve[i]) count++
  return count
}

// Heavy float: mandelbrot set iteration
function mandelbrot(width: number, height: number, maxIter: number): number {
  let total = 0
  for (let py = 0; py < height; py++) {
    const y0 = (py / height) * 3.5 - 2.0
    for (let px = 0; px < width; px++) {
      const x0 = (px / width) * 3.5 - 2.5
      let x = 0, y = 0, iter = 0
      while (x * x + y * y <= 4 && iter < maxIter) {
        const xt = x * x - y * y + x0
        y = 2 * x * y + y0
        x = xt
        iter++
      }
      total += iter
    }
  }
  return total
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

// --- True multi-core: sub-workers with multiple workloads ---

const SUB_WORKER_CODE = `
const { parentPort } = require('worker_threads')
const crypto = require('crypto')

function primeSieve(limit) {
  const sieve = new Uint8Array(limit + 1).fill(1)
  sieve[0] = sieve[1] = 0
  for (let i = 2; i * i <= limit; i++) {
    if (sieve[i]) for (let j = i * i; j <= limit; j += i) sieve[j] = 0
  }
  let count = 0
  for (let i = 2; i <= limit; i++) if (sieve[i]) count++
  return count
}

function mandelbrot(w, h, maxIter) {
  let total = 0
  for (let py = 0; py < h; py++) {
    const y0 = (py / h) * 3.5 - 2.0
    for (let px = 0; px < w; px++) {
      const x0 = (px / w) * 3.5 - 2.5
      let x = 0, y = 0, iter = 0
      while (x*x + y*y <= 4 && iter < maxIter) {
        const xt = x*x - y*y + x0; y = 2*x*y + y0; x = xt; iter++
      }
      total += iter
    }
  }
  return total
}

// Matrix multiply (float64)
function matMul(size) {
  const a = new Float64Array(size * size)
  const b = new Float64Array(size * size)
  const c = new Float64Array(size * size)
  for (let i = 0; i < size*size; i++) { a[i] = Math.random(); b[i] = Math.random() }
  for (let i = 0; i < size; i++)
    for (let k = 0; k < size; k++)
      for (let j = 0; j < size; j++)
        c[i*size+j] += a[i*size+k] * b[k*size+j]
  return c[0]
}

parentPort.on('message', ({ chunk, rounds }) => {
  let totalOps = 0
  for (let r = 0; r < rounds; r++) {
    totalOps += primeSieve(chunk)                     // integer
    totalOps += mandelbrot(80, 60, 200)              // float
    totalOps += matMul(60)                           // matrix
  }
  parentPort.postMessage(totalOps)
  process.exit(0)
})
`

function runSubWorker(chunk: number, rounds: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const w = new Worker(SUB_WORKER_CODE, { eval: true })
    w.on('message', (ops: number) => resolve(ops))
    w.on('error', reject)
    w.postMessage({ chunk, rounds })
  })
}

async function runMultiCoreBurn(cores: number, durationMs: number): Promise<number> {
  // Each sub-worker processes a chunk repeatedly for the duration
  const chunk = 3_000_000
  const rounds = 20 // each round = sieve + mandelbrot + matmul

  const start = performance.now()
  const tasks: Promise<number>[] = []
  for (let i = 0; i < cores; i++) {
    tasks.push(runSubWorker(chunk, rounds))
  }
  await Promise.all(tasks)
  const elapsed = performance.now() - start
  return (chunk * rounds * cores) / (elapsed / 1000) / 1_000_000
}

async function run(): Promise<void> {
  const os = await import('os')
  const cores = os.cpus().length

  // Phase 1: Single-core integer (bigger range)
  postProgress('Single-core integer (prime sieve 50M)', 5)
  const t0 = performance.now()
  primeSieve(50_000_000)
  const singleCoreMOps = 50_000_000 / ((performance.now() - t0) / 1000) / 1_000_000
  postProgress('Single-core integer', 15, { singleCoreMOps })

  // Phase 2: Single-core float (mandelbrot)
  postProgress('Single-core float (mandelbrot 240x180)', 20)
  const t1 = performance.now()
  mandelbrot(240, 180, 300)
  const floatTime = (performance.now() - t1) / 1000
  postProgress('Single-core float', 30, { singleCoreMOps })

  // Phase 3: TRUE multi-core burn — all cores 100%
  postProgress(`Multi-core burn · ${cores} threads · sieve+mandelbrot+matrix`, 35)
  const multiCoreMOps = await runMultiCoreBurn(cores, 5000)
  postProgress('Multi-core complete', 70, { singleCoreMOps, multiCoreMOps })

  // Phase 4: Crypto (longer)
  postProgress('Crypto throughput (AES-256-CBC)', 75)
  const cryptoMBps = cryptoBenchmark(5000)
  postProgress('Crypto throughput', 95, { singleCoreMOps, multiCoreMOps, cryptoMBps })

  // Phase 5: SHA-256 hash storm (single-core, different workload)
  postProgress('SHA-256 hash storm', 97)
  const hashData = Buffer.alloc(1024 * 1024)
  const hashStart = performance.now()
  let hashes = 0
  while (performance.now() - hashStart < 2000) {
    crypto.createHash('sha256').update(hashData).digest('hex')
    hashes++
  }
  const hashMBps = (hashes * 1024 * 1024) / ((performance.now() - hashStart) / 1000) / (1024 * 1024)

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
