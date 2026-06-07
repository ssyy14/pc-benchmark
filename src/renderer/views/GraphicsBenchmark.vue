<script setup lang="ts">
import { ref, computed, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore } from '../stores/benchmark'
import { calculateGraphicsScore } from '../utils/scoring'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()

const isRunning = ref(false)
const progressPercent = ref(0)
const progressPhase = ref('')
const liveValue = ref('')
const result = computed(() => benchmark.resultMap['graphics'])

// --- WebGL Particle System ---

function createGL(width: number, height: number): WebGL2RenderingContext {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl2', {
    powerPreference: 'high-performance',
    antialias: false,
    desynchronized: true,
  })
  if (!gl) throw new Error('WebGL2 unavailable')
  return gl
}

// Particle vertex shader
const PARTICLE_VERT = `#version 300 es
in vec2 aPos;
in float aSize;
in vec3 aColor;
in float aAlpha;
out vec3 vColor;
out float vAlpha;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  gl_PointSize = aSize;
  vColor = aColor;
  vAlpha = aAlpha;
}
`

const PARTICLE_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float alpha = 1.0 - smoothstep(0.0, 1.0, d);
  alpha *= vAlpha;
  fragColor = vec4(vColor, alpha);
}
`

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number
  size: number; r: number; g: number; b: number
}

function createParticles(count: number, width: number, height: number): Particle[] {
  const p: Particle[] = []
  for (let i = 0; i < count; i++) {
    p.push({
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      vx: (Math.random() - 0.5) * 0.02,
      vy: (Math.random() - 0.5) * 0.02,
      life: Math.random(),
      maxLife: 0.5 + Math.random() * 2.0,
      size: 1 + Math.random() * 8,
      r: Math.random(), g: Math.random(), b: Math.random(),
    })
  }
  return p
}

function updateParticles(p: Particle[], dt: number, w: number, h: number): void {
  const aspect = w / h
  for (let i = 0; i < p.length; i++) {
    const pt = p[i]
    pt.x += pt.vx * dt
    pt.y += pt.vy * dt * aspect
    pt.life += dt
    if (pt.life > pt.maxLife) {
      pt.life = 0
      pt.x = (Math.random() - 0.5) * 2
      pt.y = (Math.random() - 0.5) * 2
      pt.vx = (Math.random() - 0.5) * 0.03
      pt.vy = (Math.random() - 0.5) * 0.03
    }
    // Bounce at edges
    if (Math.abs(pt.x) > 1) pt.vx *= -1
    if (Math.abs(pt.y) > 1) pt.vy *= -1
  }
}

function runParticleBenchmark(
  gl: WebGL2RenderingContext,
  particleCount: number,
  durationMs: number
): { fps: number; totalParticles: number } {
  const prog = gl.createProgram()!
  const vs = gl.createShader(gl.VERTEX_SHADER)!
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(vs, PARTICLE_VERT); gl.compileShader(vs)
  gl.shaderSource(fs, PARTICLE_FRAG); gl.compileShader(fs)
  gl.attachShader(prog, vs); gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.useProgram(prog)

  const particles = createParticles(particleCount, gl.canvas.width, gl.canvas.height)

  // Upload buffers
  const posData = new Float32Array(particleCount * 2)
  const sizeData = new Float32Array(particleCount)
  const colorData = new Float32Array(particleCount * 3)
  const alphaData = new Float32Array(particleCount)

  function updateBuffers() {
    for (let i = 0; i < particleCount; i++) {
      const p = particles[i]
      posData[i * 2] = p.x; posData[i * 2 + 1] = p.y
      sizeData[i] = p.size
      const alpha = 1 - (p.life / p.maxLife)
      colorData[i * 3] = p.r; colorData[i * 3 + 1] = p.g; colorData[i * 3 + 2] = p.b
      alphaData[i] = alpha
    }
  }

  const posBuf = gl.createBuffer()!
  const sizeBuf = gl.createBuffer()!
  const colorBuf = gl.createBuffer()!
  const alphaBuf = gl.createBuffer()!

  // Position
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
  gl.bufferData(gl.ARRAY_BUFFER, 8 * particleCount, gl.DYNAMIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  // Size
  gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf)
  gl.bufferData(gl.ARRAY_BUFFER, 4 * particleCount, gl.DYNAMIC_DRAW)
  const aSize = gl.getAttribLocation(prog, 'aSize')
  gl.enableVertexAttribArray(aSize)
  gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0)

  // Color
  gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf)
  gl.bufferData(gl.ARRAY_BUFFER, 12 * particleCount, gl.DYNAMIC_DRAW)
  const aColor = gl.getAttribLocation(prog, 'aColor')
  gl.enableVertexAttribArray(aColor)
  gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, 0, 0)

  // Alpha
  gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf)
  gl.bufferData(gl.ARRAY_BUFFER, 4 * particleCount, gl.DYNAMIC_DRAW)
  const aAlpha = gl.getAttribLocation(prog, 'aAlpha')
  gl.enableVertexAttribArray(aAlpha)
  gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 0, 0)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

  const pixel = new Uint8Array(4)
  let frames = 0
  let lastUpdate = performance.now()
  const start = performance.now()
  const endTime = start + durationMs

  while (performance.now() < endTime) {
    const now = performance.now()
    const dt = Math.min((now - lastUpdate) / 1000, 0.1)

    updateParticles(particles, dt, gl.canvas.width, gl.canvas.height)
    updateBuffers()

    // Upload all buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, posData)
    gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sizeData)
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, colorData)
    gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, alphaData)

    // Draw as many batches as possible in this frame
    for (let b = 0; b < 5; b++) {
      gl.drawArrays(gl.POINTS, 0, particleCount)
    }
    frames++

    if (frames % 5 === 0) {
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    }

    lastUpdate = now
  }

  const elapsed = (performance.now() - start) / 1000
  gl.disable(gl.BLEND)

  return {
    fps: Math.round(frames / elapsed),
    totalParticles: frames * particleCount * 5, // 5 draw calls per frame
  }
}

// --- 2D Canvas Stress Test ---
function runCanvasBenchmark(width: number, height: number, durationMs: number): number {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  if (!ctx) throw new Error('Canvas 2D unavailable')

  let ops = 0
  const start = performance.now()

  while (performance.now() - start < durationMs) {
    // Batch of heavy 2D operations
    for (let i = 0; i < 100; i++) {
      const x = Math.random() * width
      const y = Math.random() * height
      const r = Math.random() * 40 + 5

      // Radial gradient
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      const hue = (ops * 7 + i * 37) % 360
      grad.addColorStop(0, `hsla(${hue}, 80%, 60%, 0.9)`)
      grad.addColorStop(0.5, `hsla(${(hue + 60) % 360}, 70%, 50%, 0.5)`)
      grad.addColorStop(1, `hsla(${(hue + 120) % 360}, 60%, 40%, 0)`)

      ctx.beginPath()
      // Random shape
      const shape = i % 4
      if (shape === 0) {
        ctx.arc(x, y, r, 0, Math.PI * 2)
      } else if (shape === 1) {
        ctx.rect(x - r, y - r, r * 2, r * 2)
      } else if (shape === 2) {
        const sides = 6
        ctx.moveTo(x + r * Math.cos(0), y + r * Math.sin(0))
        for (let s = 1; s <= sides; s++) {
          const angle = (s / sides) * Math.PI * 2
          ctx.lineTo(x + r * Math.cos(angle), y + r * Math.sin(angle))
        }
      } else {
        ctx.ellipse(x, y, r, r * 0.6, Math.random() * Math.PI, 0, Math.PI * 2)
      }

      ctx.fillStyle = grad
      ctx.fill()

      // Shadow and stroke
      ctx.shadowColor = `hsla(${hue}, 80%, 40%, 0.3)`
      ctx.shadowBlur = r * 0.5
      ctx.strokeStyle = `hsla(${hue}, 90%, 70%, 0.7)`
      ctx.lineWidth = 1 + Math.random()
      ctx.stroke()
      ctx.shadowBlur = 0
    }
    ops += 100
  }

  return ops / ((performance.now() - start) / 1000) // ops/sec
}

async function start() {
  isRunning.value = true
  benchmark.isRunning = true
  benchmark.runningType = 'graphics'

  const startTime = performance.now()
  let finalMetrics: Record<string, number> = {}

  try {
    // Phase 1: WebGL 200K particles at 1080p — heavy GPU + CPU
    progressPhase.value = 'WebGL 200K particles (1080p)'
    progressPercent.value = 5
    liveValue.value = 'Spawning 200,000 particles...'
    await nextTick()

    const gl1080 = createGL(1920, 1080)
    const r1080 = runParticleBenchmark(gl1080, 200_000, 5000)
    liveValue.value = `${r1080.fps} FPS, ${(r1080.totalParticles / 1e9).toFixed(1)}B particles`
    progressPhase.value = `1080p: ${r1080.fps} FPS · ${(r1080.totalParticles / 1e9).toFixed(1)}B drawn`
    progressPercent.value = 35

    // Phase 2: 100K particles at 4K — pure GPU throughput
    progressPhase.value = 'WebGL 100K particles (4K)'
    progressPercent.value = 40
    await nextTick()

    const gl4k = createGL(3840, 2160)
    const r4k = runParticleBenchmark(gl4k, 100_000, 4000)
    liveValue.value = `${r4k.fps} FPS @ 4K`
    progressPhase.value = `4K: ${r4k.fps} FPS`
    progressPercent.value = 70

    // Phase 3: 2D Canvas stress (1080p)
    progressPhase.value = '2D Canvas stress (shapes + gradients + shadows)'
    progressPercent.value = 75
    liveValue.value = 'Rendering...'
    await nextTick()

    const canvasOps = runCanvasBenchmark(1920, 1080, 4000)
    liveValue.value = `${Math.round(canvasOps).toLocaleString()} ops/s`

    progressPercent.value = 100
    progressPhase.value = 'Complete'
    liveValue.value = ''

    finalMetrics = {
      fps1080p: r1080.fps,
      fps4k: r4k.fps,
      canvasOpsPerSec: Math.round(canvasOps),
      totalParticlesDrawn: r1080.totalParticles + r4k.totalParticles,
      duration: Math.round(performance.now() - startTime),
    }

    const score = calculateGraphicsScore({
      fps1080p: r1080.fps,
      fps720p: r4k.fps,
      fps480p: Math.round(canvasOps / 1000),
    })
    benchmark.setResult({
      type: 'graphics', score,
      metrics: finalMetrics,
      duration: finalMetrics.duration,
    })
  } catch (e: any) {
    console.error('Graphics benchmark error:', e)
  } finally {
    isRunning.value = false
    benchmark.isRunning = false
    benchmark.runningType = null
  }
}

onUnmounted(() => {
  window.benchmarkAPI?.removeProgressListener()
})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">🖼️ {{ $t('nav.graphics') }}</h2>
        <p class="page-subtitle">WebGL 200K particles + 4K rendering + 2D Canvas stress with gradients & shadows</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <div v-if="isRunning" class="bench-card mb-6">
      <ProgressBar :progress="progressPercent" :phase="progressPhase" status="running" />
      <div v-if="liveValue" class="text-center mt-4">
        <div class="text-3xl font-bold text-[#2563eb]">{{ liveValue }}</div>
      </div>
    </div>

    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />
      <div class="grid grid-cols-3 gap-4 mt-4 text-center">
        <div class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps1080p }}</div>
          <div class="text-xs text-gray-400">1080p FPS (200K particles)</div>
        </div>
        <div class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps4k }}</div>
          <div class="text-xs text-gray-400">4K FPS (100K particles)</div>
        </div>
        <div class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ (result.metrics.totalParticlesDrawn / 1e9).toFixed(2) }}B</div>
          <div class="text-xs text-gray-400">Total Particles Drawn</div>
        </div>
      </div>
      <div class="text-center text-sm text-gray-400 mt-2">
        {{ $t('benchmark.duration') }}: {{ (result.duration / 1000).toFixed(1) }}{{ $t('common.seconds') }}
      </div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">🖼️</div>
      <p>{{ $t('benchmark.notRun') }}</p>
    </div>
  </div>
</template>
