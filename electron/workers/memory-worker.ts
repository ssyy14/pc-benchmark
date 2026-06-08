import { parentPort } from 'worker_threads'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'memory', phase, progress, metrics })
}

// Use native buffer-level operations for fair read/write comparison
function benchmarkReadBandwidth(size: number, iterations: number): number {
  const src = Buffer.alloc(size, 0xAB)
  const dst = Buffer.alloc(size)
  const totalBytes = size * iterations
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    src.copy(dst) // native C++ copy — equivalent to memcpy
  }
  // Prevent dead-code elimination
  if (dst[0] < 0) throw new Error('unreachable')
  return totalBytes / ((performance.now() - start) / 1000) / (1024 * 1024)
}

function benchmarkWriteBandwidth(size: number, iterations: number): number {
  const buffer = Buffer.alloc(size)
  const totalBytes = size * iterations
  const start = performance.now()
  for (let i = 0; i < iterations; i++) buffer.fill(i & 0xff)
  const elapsed = performance.now() - start
  return totalBytes / (elapsed / 1000) / (1024 * 1024)
}

function benchmarkLatency(size: number, accessCount: number): number {
  const buffer = Buffer.alloc(size)
  // Pre-generate random indices in a typed array for faster access
  const indices = new Uint32Array(accessCount)
  // Use a simple LCG for fast pseudo-random (avoids Math.random overhead)
  let seed = 42
  for (let i = 0; i < accessCount; i++) {
    seed = (seed * 1664525 + 1013904223) | 0
    indices[i] = (seed >>> 0) % size
  }
  const start = performance.now()
  let sum = 0
  for (let i = 0; i < accessCount; i++) sum += buffer[indices[i]]
  const elapsed = performance.now() - start
  if (sum < 0) throw new Error('unreachable')
  return (elapsed / accessCount) * 1_000_000
}

async function run(): Promise<void> {
  const startTime = performance.now()

  postProgress('Sequential read bandwidth', 10)
  const readMBps = benchmarkReadBandwidth(16 * 1024 * 1024, 20)
  postProgress('Sequential read bandwidth', 35, { readBandwidthMBps: Math.round(readMBps) })

  postProgress('Sequential write bandwidth', 40)
  const writeMBps = benchmarkWriteBandwidth(16 * 1024 * 1024, 20)
  postProgress('Sequential write bandwidth', 65, {
    readBandwidthMBps: Math.round(readMBps),
    writeBandwidthMBps: Math.round(writeMBps),
  })

  postProgress('Random access latency', 70)
  const latencyNs = benchmarkLatency(64 * 1024 * 1024, 500_000)
  postProgress('Random access latency', 100, {
    readBandwidthMBps: Math.round(readMBps),
    writeBandwidthMBps: Math.round(writeMBps),
    latencyNs: Math.round(latencyNs * 100) / 100,
  })

  parentPort?.postMessage({
    type: 'memory', phase: 'complete', progress: 100, done: true,
    metrics: {
      readBandwidthMBps: Math.round(readMBps),
      writeBandwidthMBps: Math.round(writeMBps),
      latencyNs: Math.round(latencyNs * 100) / 100,
      duration: Math.round(performance.now() - startTime),
    },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
