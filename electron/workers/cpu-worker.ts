import { parentPort } from 'worker_threads'
import crypto from 'crypto'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'cpu', phase, progress, metrics })
}

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

async function run(): Promise<void> {
  const os = await import('os')
  const cores = os.cpus().length

  postProgress('Single-core integer (prime sieve)', 10)
  const t0 = performance.now()
  const primeLimit = 10_000_000
  primeSieve(primeLimit)
  const singleCoreTime = performance.now() - t0
  const singleCoreMOps = primeLimit / (singleCoreTime / 1000) / 1_000_000
  postProgress('Single-core integer', 25, { singleCoreMOps })

  postProgress('Single-core floating-point (pi)', 30)
  computePi(200_000_000)
  postProgress('Single-core floating-point', 45)

  postProgress('Multi-core parallel', 50)
  const t2 = performance.now()
  const chunkSize = Math.floor(3_000_000 / cores)
  const promises: Promise<number>[] = []
  for (let i = 0; i < cores; i++) {
    promises.push(new Promise((resolve) => { setImmediate(() => resolve(primeSieve(chunkSize))) }))
  }
  await Promise.all(promises)
  const multiCoreTime = performance.now() - t2
  const multiCoreMOps = (chunkSize * cores) / (multiCoreTime / 1000) / 1_000_000
  postProgress('Multi-core parallel', 80, { singleCoreMOps, multiCoreMOps })

  postProgress('Crypto throughput (AES-256)', 85)
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
