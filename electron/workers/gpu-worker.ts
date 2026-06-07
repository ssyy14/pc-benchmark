import { parentPort, Worker } from 'worker_threads'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'gpu', phase, progress, metrics })
}

// True parallel matrix multiply using sub-workers
function runMatrixSubWorker(rows: number, size: number): Promise<void> {
  const code = `
    const { parentPort } = require('worker_threads')
    parentPort.on('message', ({ rows, size }) => {
      const a = new Float64Array(rows * size).fill(1.5)
      const b = new Float64Array(size * size).fill(1.5)
      const c = new Float64Array(rows * size)
      for (let i = 0; i < rows; i++) {
        for (let k = 0; k < size; k++) {
          const aik = a[i * size + k]
          for (let j = 0; j < size; j++) {
            c[i * size + j] += aik * b[k * size + j]
          }
        }
      }
      parentPort.postMessage('done')
      process.exit(0)
    })
  `
  return new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true })
    w.on('message', () => resolve())
    w.on('error', reject)
    w.postMessage({ rows, size })
  })
}

async function parallelMatrixMultiply(size: number, threads: number): Promise<number> {
  const totalOps = 2 * size * size * size // 2N³ FLOPs
  const rowsPerThread = Math.floor(size / threads)

  const start = performance.now()
  const tasks: Promise<void>[] = []
  for (let t = 0; t < threads; t++) {
    tasks.push(runMatrixSubWorker(rowsPerThread, size))
  }
  await Promise.all(tasks)
  const elapsed = performance.now() - start
  return totalOps / (elapsed / 1000) / 1e9 // GFLOPS
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
  const os = await import('os')
  const cores = os.cpus().length
  const startTime = performance.now()

  postProgress(`Parallel matrix multiply (${cores} threads)`, 20)
  const computeGFLOPS = await parallelMatrixMultiply(1024, cores)
  postProgress('Matrix multiply complete', 60, { computeGFLOPS: Math.round(computeGFLOPS * 100) / 100 })

  postProgress('Memory bandwidth', 70)
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
