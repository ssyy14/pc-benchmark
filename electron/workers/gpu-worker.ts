import { parentPort } from 'worker_threads'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'gpu', phase, progress, metrics })
}

function matrixMultiply(size: number): number {
  const totalOps = 2 * size * size * size
  const a = new Float64Array(size * size).fill(1)
  const b = new Float64Array(size * size).fill(1)
  const c = new Float64Array(size * size)

  const start = performance.now()
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < size; k++) {
      const aik = a[i * size + k]
      for (let j = 0; j < size; j++) {
        c[i * size + j] += aik * b[k * size + j]
      }
    }
  }
  const elapsed = performance.now() - start
  return totalOps / (elapsed / 1000) / 1e9
}

function memoryBandwidthBenchmark(sizeMB: number): number {
  const size = sizeMB * 1024 * 1024
  const src = Buffer.alloc(size, 0xAA)
  const dst = Buffer.alloc(size)
  const start = performance.now()
  src.copy(dst)
  const elapsed = performance.now() - start
  return size / (1024 * 1024 * 1024) / (elapsed / 1000)
}

async function run(): Promise<void> {
  const startTime = performance.now()

  postProgress('GPU compute (matrix multiply)', 15)
  const computeGFLOPS = matrixMultiply(512)
  postProgress('GPU compute simulation', 50, { computeGFLOPS: Math.round(computeGFLOPS * 100) / 100 })

  postProgress('Memory bandwidth', 55)
  const memBandwidth = memoryBandwidthBenchmark(256)
  postProgress('Memory bandwidth', 100, {
    computeGFLOPS: Math.round(computeGFLOPS * 100) / 100,
    memoryBandwidthGBps: Math.round(memBandwidth * 100) / 100,
  })

  parentPort?.postMessage({
    type: 'gpu', phase: 'complete', progress: 100, done: true,
    metrics: {
      computeGFLOPS: Math.round(computeGFLOPS * 100) / 100,
      memoryBandwidthGBps: Math.round(memBandwidth * 100) / 100,
      duration: Math.round(performance.now() - startTime),
    },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
