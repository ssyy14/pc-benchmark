import { parentPort } from 'worker_threads'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'memory', phase, progress, metrics })
}

function benchmarkReadBandwidth(size: number, iterations: number): number {
  const buffer = Buffer.alloc(size)
  const totalBytes = size * iterations
  const start = performance.now()
  let sum = 0
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < buffer.length; j++) sum += buffer[j]
  }
  const elapsed = performance.now() - start
  if (sum < 0) throw new Error('unreachable')
  return totalBytes / (elapsed / 1000) / (1024 * 1024)
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
  const indices = new Uint32Array(accessCount)
  for (let i = 0; i < accessCount; i++) indices[i] = Math.floor(Math.random() * size)
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
