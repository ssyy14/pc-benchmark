import { parentPort } from 'worker_threads'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'graphics', phase, progress, metrics })
}

function simulateParticles(count: number, frames: number): number {
  const particles = new Float64Array(count * 4)
  for (let i = 0; i < count; i++) {
    particles[i * 4] = Math.random() * 1920
    particles[i * 4 + 1] = Math.random() * 1080
    particles[i * 4 + 2] = (Math.random() - 0.5) * 10
    particles[i * 4 + 3] = (Math.random() - 0.5) * 10
  }
  const start = performance.now()
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < count; i++) {
      const idx = i * 4
      particles[idx] += particles[idx + 2]
      particles[idx + 1] += particles[idx + 3]
      if (particles[idx] < 0 || particles[idx] > 1920) particles[idx + 2] *= -1
      if (particles[idx + 1] < 0 || particles[idx + 1] > 1080) particles[idx + 3] *= -1
    }
  }
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
  const startTime = performance.now()

  postProgress('1080p particle simulation', 10)
  const t1080 = simulateParticles(50000, 60)
  const fps1080p = Math.round(60 / Math.max(t1080, 0.001))
  postProgress('1080p rendering', 35, { fps1080p })

  postProgress('720p particle simulation', 40)
  const t720 = simulateParticles(25000, 60)
  const fps720p = Math.round(60 / Math.max(t720, 0.001))
  postProgress('720p rendering', 65, { fps1080p, fps720p })

  postProgress('2D rendering operations', 70)
  const t2d = simulate2DRendering(2_000_000)
  const fps480p = Math.round(fps720p * 1.5)
  postProgress('2D rendering', 100, { fps1080p, fps720p, fps480p })

  parentPort?.postMessage({
    type: 'graphics', phase: 'complete', progress: 100, done: true,
    metrics: {
      fps1080p, fps720p, fps480p,
      duration: Math.round(performance.now() - startTime),
    },
  })
  process.exit(0)
}

run().catch((err) => { parentPort?.postMessage({ error: err.message }); process.exit(1) })
