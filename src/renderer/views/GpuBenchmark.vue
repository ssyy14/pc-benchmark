<script setup lang="ts">
import { ref, computed, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore } from '../stores/benchmark'
import { calculateGpuScore } from '../utils/scoring'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()

const isRunning = ref(false)
const progressPercent = ref(0)
const progressPhase = ref('')
const liveFps = ref(0)
const result = computed(() => benchmark.resultMap['gpu'])

// --- Real WebGL GPU rendering test ---

function createWebGLContext(width: number, height: number): WebGL2RenderingContext {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance', antialias: false })
  if (!gl) throw new Error('WebGL2 not available')
  return gl
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile: ' + gl.getShaderInfoLog(shader))
  }
  return shader
}

function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  return prog
}

// Heavy fragment shader: noise + lighting + reflections
const HEAVY_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform float uTime;
uniform vec2 uResolution;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUV * (uResolution / min(uResolution.x, uResolution.y));
  uv += uTime * 0.1;

  // Layered noise
  float n1 = fbm(uv * 3.0);
  float n2 = fbm(uv * 5.0 + uTime * 0.2);
  float n3 = fbm(uv * 8.0 - uTime * 0.15);

  // Simulated lighting
  vec3 lightPos = vec3(sin(uTime) * 2.0, cos(uTime * 0.7) * 2.0, 3.0);
  vec3 normal = normalize(vec3(n1 - 0.5, n2 - 0.5, 1.0));
  vec3 lightDir = normalize(lightPos - vec3(uv * 4.0 - 2.0, 0.0));
  float diffuse = max(dot(normal, lightDir), 0.0);
  float specular = pow(max(dot(reflect(-lightDir, normal), vec3(0.0, 0.0, 1.0)), 0.0), 32.0);

  // Metallic reflection
  vec3 reflected = vec3(fbm(uv * 6.0 + n1), fbm(uv * 6.0 + n2), fbm(uv * 6.0 + n3));
  float fresnel = pow(1.0 - abs(normal.z), 3.0);

  vec3 color = mix(
    mix(reflected, vec3(0.02, 0.03, 0.05), 0.3),
    reflected * 2.0,
    fresnel
  );
  color += diffuse * vec3(0.3, 0.5, 0.8) * 0.5;
  color += specular * vec3(1.0, 0.9, 0.7) * 0.3;
  color += n3 * vec3(0.2, 0.1, 0.3) * 0.3;

  // HDR tone mapping
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));

  fragColor = vec4(color, 1.0);
}
`

const VERT_SRC = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

function runWebGLBenchmark(gl: WebGL2RenderingContext, durationMs: number): number {
  const prog = createProgram(gl, VERT_SRC, HEAVY_FRAG)

  // Fullscreen quad
  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0,
     1, -1, 1, 0,
    -1,  1, 0, 1,
     1,  1, 1, 1,
  ]), gl.STATIC_DRAW)

  const aPos = gl.getAttribLocation(prog, 'aPosition')
  const aUV = gl.getAttribLocation(prog, 'aUV')
  gl.enableVertexAttribArray(aPos)
  gl.enableVertexAttribArray(aUV)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8)

  gl.useProgram(prog)
  const uTime = gl.getUniformLocation(prog, 'uTime')
  const uRes = gl.getUniformLocation(prog, 'uResolution')

  let frames = 0
  const start = performance.now()
  const endTime = start + durationMs

  function render() {
    const now = performance.now()
    if (now >= endTime) return
    frames++
    gl.uniform1f(uTime, now * 0.001)
    gl.uniform2f(uRes, gl.canvas.width, gl.canvas.height)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    // Force GPU flush by reading a pixel every 60 frames
    if (frames % 60 === 0) {
      const pixel = new Uint8Array(4)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    }
    requestAnimationFrame(render)
  }

  return new Promise(resolve => {
    render()
    const check = setInterval(() => {
      if (performance.now() >= endTime) {
        clearInterval(check)
        const elapsed = (performance.now() - start) / 1000
        resolve(Math.round(frames / elapsed))
      }
    }, durationMs + 100)
  })
}

async function start() {
  isRunning.value = true
  benchmark.isRunning = true
  benchmark.runningType = 'gpu'

  const startTime = performance.now()
  let finalMetrics: Record<string, number> = {}

  try {
    // Phase 1: WebGL 720p test (real GPU rendering)
    progressPhase.value = 'WebGL 720p heavy shader rendering'
    progressPercent.value = 10
    await nextTick()

    let gl = createWebGLContext(1280, 720)
    const fps720 = await runWebGLBenchmark(gl, 3000)
    liveFps.value = fps720
    progressPhase.value = `720p: ${fps720} FPS`
    progressPercent.value = 35

    // Phase 2: WebGL 1080p test
    progressPhase.value = 'WebGL 1080p heavy shader rendering'
    progressPercent.value = 40
    await nextTick()

    gl = createWebGLContext(1920, 1080)
    const fps1080 = await runWebGLBenchmark(gl, 3000)
    liveFps.value = fps1080
    progressPhase.value = `1080p: ${fps1080} FPS`
    progressPercent.value = 70

    // Phase 3: Memory bandwidth (texture upload stress)
    progressPhase.value = 'GPU memory bandwidth (texture upload)'
    progressPercent.value = 75
    await nextTick()

    const texGl = createWebGLContext(4096, 4096)
    const tex = texGl.createTexture()!
    texGl.bindTexture(texGl.TEXTURE_2D, tex)
    const texData = new Uint8Array(4096 * 4096 * 4)
    for (let i = 0; i < texData.length; i += 4) {
      texData[i] = (i * 7) & 0xff
      texData[i + 1] = (i * 13) & 0xff
      texData[i + 2] = (i * 23) & 0xff
      texData[i + 3] = 255
    }

    const bwStart = performance.now()
    let uploads = 0
    while (performance.now() - bwStart < 2000) {
      texGl.texImage2D(texGl.TEXTURE_2D, 0, texGl.RGBA, 4096, 4096, 0, texGl.RGBA, texGl.UNSIGNED_BYTE, texData)
      uploads++
    }
    const bwElapsed = (performance.now() - bwStart) / 1000
    const gpuBandwidth = (uploads * 4096 * 4096 * 4) / bwElapsed / (1024 * 1024 * 1024) // GB/s

    progressPercent.value = 100
    liveFps.value = 0

    finalMetrics = {
      fps1080p: fps1080,
      fps720p: fps720,
      gpuBandwidthGBps: Math.round(gpuBandwidth * 100) / 100,
      duration: Math.round(performance.now() - startTime),
    }

    const gpuResult = {
      type: 'gpu' as const,
      score: 0,
      metrics: finalMetrics,
      duration: finalMetrics.duration,
    }
    const score = calculateGpuScore(finalMetrics)
    benchmark.setResult({ ...gpuResult, score })
  } catch (e: any) {
    console.error('GPU benchmark failed:', e)
    // Fallback: try worker-based test
    try {
      progressPhase.value = 'Falling back to CPU compute test...'
      const r = await window.benchmarkAPI.runBenchmark('gpu')
      const score = calculateGpuScore(r.metrics)
      benchmark.setResult({ ...r, score })
    } catch (e2) {
      console.error('Fallback also failed:', e2)
    }
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
        <h2 class="page-title">🎮 {{ $t('nav.gpu') }}</h2>
        <p class="page-subtitle">Real GPU rendering via WebGL — heavy shaders, texture bandwidth</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <div v-if="isRunning" class="bench-card mb-6">
      <ProgressBar :progress="progressPercent" :phase="progressPhase" status="running" />
      <div v-if="liveFps" class="text-center mt-4">
        <div class="text-4xl font-bold text-[#2563eb]">{{ liveFps }}</div>
        <div class="text-sm text-gray-400">Live FPS</div>
      </div>
    </div>

    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />
      <div class="grid grid-cols-3 gap-4 mt-4 text-center">
        <div v-if="result.metrics.fps1080p" class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps1080p }}</div>
          <div class="text-xs text-gray-400">1080p FPS</div>
        </div>
        <div v-if="result.metrics.fps720p" class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps720p }}</div>
          <div class="text-xs text-gray-400">720p FPS</div>
        </div>
        <div v-if="result.metrics.gpuBandwidthGBps" class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.gpuBandwidthGBps }}</div>
          <div class="text-xs text-gray-400">GPU BW GB/s</div>
        </div>
      </div>
      <div class="text-center text-sm text-gray-400 mt-2">
        {{ $t('benchmark.duration') }}: {{ (result.duration / 1000).toFixed(1) }}{{ $t('common.seconds') }}
      </div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">🎮</div>
      <p>{{ $t('benchmark.notRun') }}</p>
    </div>
  </div>
</template>
