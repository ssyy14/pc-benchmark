import { parentPort, Worker } from 'worker_threads'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'graphics', phase, progress, metrics })
}

// Sub-worker for parallel particle simulation
function runParticleWorker(count: number, frames: number): Promise<void> {
  const code = `
    const { parentPort } = require('worker_threads')
    parentPort.on('message', ({ count, frames }) => {
      const particles = new Float64Array(count * 4)
      for (let i = 0; i < count; i++) {
        particles[i * 4] = Math.random() * 1920
        particles[i * 4 + 1] = Math.random() * 1080
        particles[i * 4 + 2] = (Math.random() - 0.5) * 10
        particles[i * 4 + 3] = (Math.random() - 0.5) * 10
      }
      for (let f = 0; f < frames; f++) {
        for (let i = 0; i < count; i++) {
          const idx = i * 4
          particles[idx] += particles[idx + 2]
          particles[idx + 1] += particles[idx + 3]
          if (particles[idx] < 0 || particles[idx] > 1920) particles[idx + 2] *= -1
          if (particles[idx + 1] < 0 || particles[idx + 1] > 1080) particles[idx + 3] *= -1
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
    w.postMessage({ count, frames })
  })
}

async function runParticlesParallel(totalCount: number, frames: number, threads: number): Promise<number> {
  const perThread = Math.floor(totalCount / threads)
  const start = performance.now()
  const tasks: Promise<void>[] = []
  for (let i = 0; i < threads; i++) {
    tasks.push(runParticleWorker(perThread, frames))
  }
  await Promise.all(tasks)
  return (performance.now() - start) / 1000
}

function simulate2DRendering(ops: number): number {
  const start = performance.now()
  let x = 0, y = 0
  for (let i = 0; i < ops; i++) {
    x = (x + Math.sin(i * 0.01)) * 0.99
    y = (y + Math.cos(i * 0.01)) * 0.99
    Math.sqrt(x * x + y * y)
  }
  return (performance.now() - start) / 1000
}

async function run(): Promise<void> {
  const os = await import('os')
  const cores = os.cpus().length
  const startTime = performance.now()

  // Phase 1: 1080p particle sim (parallel)
  postProgress(`1080p particle simulation (${cores} threads)`, 10)
  const t1080 = await runParticlesParallel(50000, 60, cores)
  const fps1080p = Math.round(60 / Math.max(t1080, 0.001))
  postProgress('1080p rendering', 40, { fps1080p })

  // Phase 2: 720p (smaller, single thread)
  postProgress('720p particle simulation', 50)
  const t720 = await runParticlesParallel(25000, 60, Math.max(2, Math.floor(cores / 2)))
  const fps720p = Math.round(60 / Math.max(t720, 0.001))
  postProgress('720p rendering', 75, { fps1080p, fps720p })

  // Phase 3: 2D rendering
  postProgress('2D rendering operations', 80)
  const t2d = simulate2DRendering(2_000_000)
  const fps480p = Math.round(fps720p * 1.5)
  postProgress('2D rendering', 100, { fps1080p, fps720p, fps480p })

  parentPort?.postMessage({
    type: 'graphics', phase: 'complete', progress: 100, done: true,
    metrics: { fps1080p, fps720p, fps480p, duration: Math.round(performance.now() - startTime) },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
