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
const canvasRef = ref<HTMLCanvasElement | null>(null)

const PV = `#version 300 es
in vec2 aP; in float aS; in vec3 aC; in float aA;
out vec3 vC; out float vA;
void main(){gl_Position=vec4(aP,0,1);gl_PointSize=aS;vC=aC;vA=aA;}`

const PF = `#version 300 es
precision highp float;
in vec3 vC; in float vA; out vec4 o;
void main(){
  float d=length(gl_PointCoord-.5)*2.0;
  float a=vA*(1.0-smoothstep(0.0,1.0,d));
  // Glow effect
  float glow=exp(-d*3.0)*.5;
  o=vec4(vC+glow,a);
}`

interface P { x:number;y:number;vx:number;vy:number;life:number;max:number;size:number;r:number;g:number;b:number }

function mkParts(n: number): P[] {
  const a: P[] = []
  for (let i = 0; i < n; i++) a.push({
    x: Math.random() * 2 - 1, y: Math.random() * 2 - 1,
    vx: (Math.random() - .5) * .02, vy: (Math.random() - .5) * .02,
    life: Math.random(), max: .5 + Math.random() * 2,
    size: 1 + Math.random() * 8,
    r: Math.random(), g: Math.random(), b: Math.random(),
  })
  return a
}

function updParts(p: P[], dt: number, asp: number): void {
  for (let i = 0; i < p.length; i++) {
    const t = p[i]
    t.x += t.vx * dt; t.y += t.vy * dt * asp; t.life += dt
    if (t.life > t.max) {
      t.life = 0; t.x = (Math.random() - .5) * 2; t.y = (Math.random() - .5) * 2
      t.vx = (Math.random() - .5) * .03; t.vy = (Math.random() - .5) * .03
    }
    if (Math.abs(t.x) > 1) t.vx *= -1
    if (Math.abs(t.y) > 1) t.vy *= -1
  }
}

function runParticles(
  gl: WebGL2RenderingContext, count: number, drawsPerFrame: number, durationMs: number
): Promise<{fps:number;total:number}> {
  const p = gl.createProgram()!
  const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, PV); gl.compileShader(vs); gl.attachShader(p, vs)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, PF); gl.compileShader(fs); gl.attachShader(p, fs)
  gl.linkProgram(p); gl.useProgram(p)

  const parts = mkParts(count)
  const pos = new Float32Array(count * 2), sz = new Float32Array(count)
  const col = new Float32Array(count * 3), alp = new Float32Array(count)

  function upd() {
    for (let i = 0; i < count; i++) {
      const t = parts[i]; pos[i * 2] = t.x; pos[i * 2 + 1] = t.y
      sz[i] = t.size; col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b
      alp[i] = 1 - t.life / t.max
    }
  }

  const bufs = [0, 1, 2, 3].map(() => gl.createBuffer()!)
  const upload = (i: number, data: Float32Array) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, bufs[i]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
  }
  // Init buffers
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs[0]); gl.bufferData(gl.ARRAY_BUFFER, 8 * count, gl.DYNAMIC_DRAW)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0)
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs[1]); gl.bufferData(gl.ARRAY_BUFFER, 4 * count, gl.DYNAMIC_DRAW)
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(1)
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs[2]); gl.bufferData(gl.ARRAY_BUFFER, 12 * count, gl.DYNAMIC_DRAW)
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(2)
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs[3]); gl.bufferData(gl.ARRAY_BUFFER, 4 * count, gl.DYNAMIC_DRAW)
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(3)

  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

  let frames = 0, lastUpd = performance.now()
  const start = performance.now(), endTime = start + durationMs

  return new Promise(resolve => {
    function frame() {
      const now = performance.now()
      if (now >= endTime) {
        gl.disable(gl.BLEND)
        const elapsed = (now - start) / 1000
        resolve({ fps: Math.round(frames / elapsed), total: frames * count * drawsPerFrame })
        return
      }
      const dt = Math.min((now - lastUpd) / 1000, 0.1)
      updParts(parts, dt, gl.canvas.width / gl.canvas.height); upd()
      upload(0, pos); upload(1, sz); upload(2, col); upload(3, alp)
      // Clear with slight fade for trail effect
      gl.clearColor(0, 0, 0, 0.15)
      gl.clear(gl.COLOR_BUFFER_BIT)
      for (let d = 0; d < drawsPerFrame; d++) gl.drawArrays(gl.POINTS, 0, count)
      gl.finish()
      frames++; lastUpd = now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

async function start() {
  isRunning.value = true; benchmark.isRunning = true; benchmark.runningType = 'graphics'
  const startTime = performance.now()
  let fm: Record<string, number> = {}
  try {
    // 1080p 100K particles
    progressPhase.value = '1080p · 100K glowing particles · watch them!'
    progressPercent.value = 10; liveValue.value = 'Spawning 100,000 particles...'
    await nextTick()

    const c = canvasRef.value!
    c.width = 1920; c.height = 1080
    c.style.display = 'block'
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance', antialias: false, desynchronized: true })!
    progressPercent.value = 15

    const r1 = await runParticles(gl, 100000, 20, 5000)
    liveValue.value = `${r1.fps} FPS · ${(r1.total / 1e9).toFixed(1)}B particles`
    progressPhase.value = `1080p: ${r1.fps} FPS · ${(r1.total / 1e9).toFixed(1)}B drawn`
    progressPercent.value = 50

    // 4K 80K particles
    progressPhase.value = '4K · 80K particles'
    progressPercent.value = 55
    await nextTick()
    c.width = 3840; c.height = 2160
    const r2 = await runParticles(gl, 80000, 8, 4000)
    liveValue.value = `${r2.fps} FPS @ 4K`
    progressPercent.value = 100
    progressPhase.value = 'Complete'
    liveValue.value = ''; c.style.display = 'none'

    fm = {
      fps1080p: r1.fps, fps4k: r2.fps,
      totalParticlesDrawn: r1.total + r2.total,
      duration: Math.round(performance.now() - startTime),
    }
    benchmark.setResult({
      type: 'graphics',
      score: calculateGraphicsScore({ fps1080p: r1.fps, fps720p: r2.fps, fps480p: Math.round((r1.total + r2.total) / 1e7) }),
      metrics: fm, duration: fm.duration,
    })
  } catch (e: any) { console.error(e) } finally {
    isRunning.value = false; benchmark.isRunning = false; benchmark.runningType = null
    if (canvasRef.value) canvasRef.value.style.display = 'none'
  }
}

onUnmounted(() => { window.benchmarkAPI?.removeProgressListener() })
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">🖼️ {{ $t('nav.graphics') }}</h2>
        <p class="page-subtitle">Live WebGL particle system — 100K glowing particles with trail effects!</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <!-- LIVE PARTICLE CANVAS -->
    <div v-if="isRunning" class="bench-card mb-6">
      <canvas
        ref="canvasRef"
        class="w-full rounded-lg"
        style="max-height: 400px; object-fit: contain; background: #000"
      />
      <div class="mt-3">
        <ProgressBar :progress="progressPercent" :phase="progressPhase" status="running" />
      </div>
      <div v-if="liveValue" class="text-center mt-2">
        <div class="text-3xl font-bold text-[#2563eb]">{{ liveValue }}</div>
      </div>
    </div>

    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />
      <div class="grid grid-cols-3 gap-4 mt-4 text-center">
        <div class="bench-card"><div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps1080p }}</div><div class="text-xs text-gray-400">1080p FPS</div></div>
        <div class="bench-card"><div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps4k }}</div><div class="text-xs text-gray-400">4K FPS</div></div>
        <div class="bench-card"><div class="text-2xl font-bold text-blue-600">{{ (result.metrics.totalParticlesDrawn / 1e9).toFixed(2) }}B</div><div class="text-xs text-gray-400">Total Drawn</div></div>
      </div>
      <div class="text-center text-sm text-gray-400 mt-2">{{ $t('benchmark.duration') }}: {{ (result.duration / 1000).toFixed(1) }}{{ $t('common.seconds') }}</div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">🖼️</div><p>{{ $t('benchmark.notRun') }}</p>
    </div>
  </div>
</template>
