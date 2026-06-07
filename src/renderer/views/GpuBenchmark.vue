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
const liveValue = ref('')
const result = computed(() => benchmark.resultMap['gpu'])

function createWebGLContext(width: number, height: number): WebGL2RenderingContext {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl2', {
    powerPreference: 'high-performance',
    antialias: false,
    desynchronized: true,
  })
  if (!gl) throw new Error('WebGL2 not available')
  return gl
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(shader))
  }
  return shader
}

// Extremely heavy fragment shader: multi-octave noise, volumetric lighting, ray marching
const HEAVY_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vPos;
out vec4 fragColor;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uOffset;

float hash21(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

float noise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  float lacunarity = 2.3;
  float persistence = 0.55;
  for (int i = 0; i < 8; i++) {
    value += amplitude * noise2D(p * frequency);
    frequency *= lacunarity;
    amplitude *= persistence;
  }
  return value;
}

// 3D noise for volumetric effects
float noise3D(vec3 p) {
  return fbm(p.xy * 2.0 + p.z) * fbm(p.yz * 2.0 + p.x);
}

void main() {
  vec2 uv = vUV * (uResolution / min(uResolution.x, uResolution.y));
  vec3 pos = vPos + uOffset;

  // 8 octaves of FBM at different scales
  float n0 = fbm(uv * 3.0 + uTime * 0.05);
  float n1 = fbm(uv * 5.0 + uTime * 0.1 + n0);
  float n2 = fbm(uv * 7.0 - uTime * 0.07 + n1 * 0.5);

  // Volumetric lighting simulation (ray marching style)
  float volLight = 0.0;
  for (int s = 0; s < 10; s++) {
    float t = float(s) * 0.15;
    vec3 samplePos = pos + vec3(uv * 2.0 - 1.0, 0.0) * t;
    volLight += noise3D(samplePos * 3.0 + uTime * 0.2) * exp(-t * 2.0);
  }
  volLight *= 0.12;

  // Three-layer lighting
  vec3 lightPos1 = vec3(sin(uTime) * 3.0, cos(uTime * 0.7) * 3.0, 4.0);
  vec3 lightPos2 = vec3(cos(uTime * 0.5) * 2.5, sin(uTime * 0.8) * 2.5, 3.0);
  vec3 lightPos3 = vec3(0.0, 0.0, 6.0);

  // Procedural normals from noise
  float eps = 0.005;
  float nx = fbm(uv * 4.0 + vec2(eps, 0.0)) - fbm(uv * 4.0 - vec2(eps, 0.0));
  float ny = fbm(uv * 4.0 + vec2(0.0, eps)) - fbm(uv * 4.0 - vec2(0.0, eps));
  vec3 normal = normalize(vec3(nx, ny, 0.02));

  vec3 viewDir = vec3(0.0, 0.0, 1.0);

  // Light 1
  vec3 ld1 = normalize(lightPos1 - vec3(uv * 4.0 - 2.0, 2.0));
  float d1 = max(dot(normal, ld1), 0.0);
  float s1 = pow(max(dot(reflect(-ld1, normal), viewDir), 0.0), 64.0);

  // Light 2
  vec3 ld2 = normalize(lightPos2 - vec3(uv * 3.0 - 1.5, 1.5));
  float d2 = max(dot(normal, ld2), 0.0) * 0.7;
  float s2 = pow(max(dot(reflect(-ld2, normal), viewDir), 0.0), 48.0);

  // Ambient occlusion
  float ao = 1.0 - n2 * 0.4;

  // Metallic base with iridescence
  vec3 baseColor = vec3(0.05, 0.06, 0.09);
  float iridescence = sin(uv.x * 20.0 + n0 * 3.0) * 0.5 + 0.5;
  vec3 metalColor = mix(
    vec3(0.8, 0.5, 0.2),
    vec3(0.2, 0.5, 0.9),
    iridescence
  );

  // Fresnel
  float fresnel = pow(1.0 - abs(dot(normal, viewDir)), 4.0);

  // Combine
  vec3 color = mix(baseColor, metalColor, fresnel * (0.5 + n0 * 0.5));
  color += (d1 * vec3(1.0, 0.85, 0.6) + d2 * vec3(0.5, 0.7, 1.0)) * ao * 0.4;
  color += (s1 * vec3(1.0, 0.9, 0.7) * 0.5 + s2 * vec3(0.7, 0.8, 1.0) * 0.3);
  color += volLight * vec3(1.0, 0.9, 0.85);
  color += n0 * vec3(0.1, 0.05, 0.15) * 0.2;
  color += n2 * vec3(0.15, 0.1, 0.05) * 0.15;

  // Film grain
  float grain = hash21(uv * uResolution + uTime) * 0.03;
  color += grain;

  // Vignette
  float vignette = 1.0 - length(vUV - 0.5) * 0.5;
  color *= vignette;

  // ACES tone mapping
  color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
  color = pow(color, vec3(1.0 / 2.2));

  fragColor = vec4(color, 1.0);
}
`

const VERT_SRC = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec3 aOffset;
out vec2 vUV;
out vec3 vPos;
uniform vec2 uResolution;
void main() {
  vUV = aUV;
  vPos = aOffset;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

// Run GPU benchmark WITHOUT vsync — tight render loop with sync
function runGpuBurn(gl: WebGL2RenderingContext, durationMs: number): number {
  const prog = gl.createProgram()!
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, HEAVY_FRAG)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Link error: ' + gl.getProgramInfoLog(prog))
  }

  // Create 10,000 instances — each is a separate draw
  const INSTANCES = 10000
  const offsets = new Float32Array(INSTANCES * 3)
  for (let i = 0; i < INSTANCES; i++) {
    offsets[i * 3] = (Math.random() - 0.5) * 4
    offsets[i * 3 + 1] = (Math.random() - 0.5) * 4
    offsets[i * 3 + 2] = Math.random() * 2
  }

  const offsetBuf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuf)
  gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW)

  const aOffset = gl.getAttribLocation(prog, 'aOffset')
  gl.enableVertexAttribArray(aOffset)
  gl.vertexAttribPointer(aOffset, 3, gl.FLOAT, false, 0, 0)
  gl.vertexAttribDivisor(aOffset, 1) // one per instance

  // Fullscreen quad
  const quadBuf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
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
  const uOff = gl.getUniformLocation(prog, 'uOffset')

  const pixel = new Uint8Array(4)
  let draws = 0
  const start = performance.now()
  const endTime = start + durationMs

  // Tight loop — no rAF! Forces GPU to work as fast as possible
  // gl.readPixels after every N draws syncs the GPU pipeline
  while (performance.now() < endTime) {
    for (let i = 0; i < 100; i++) {
      draws++
      const t = performance.now() * 0.001
      gl.uniform1f(uTime, t)
      gl.uniform2f(uRes, gl.canvas.width, gl.canvas.height)
      gl.uniform3f(uOff, offsets[(draws % INSTANCES) * 3], offsets[(draws % INSTANCES) * 3 + 1], offsets[(draws % INSTANCES) * 3 + 2])
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, INSTANCES)
    }
    // Sync point — force GPU pipeline flush
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
  }

  const elapsed = (performance.now() - start) / 1000
  // Return "megapixels per second" as a throughput metric
  const megapixels = (gl.canvas.width * gl.canvas.height * draws * INSTANCES) / 1_000_000
  return Math.round(megapixels / elapsed)
}

// WebGPU compute test
async function runWebGPUCompute(durationMs: number): Promise<number | null> {
  if (!('gpu' in navigator)) return null

  try {
    const adapter = await (navigator as any).gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) return null
    const device = await adapter.requestDevice()

    const MATRIX_SIZE = 2048
    const shaderCode = `
      @group(0) @binding(0) var<storage, read_write> a: array<f32>;
      @group(0) @binding(1) var<storage, read_write> b: array<f32>;
      @group(0) @binding(2) var<storage, read_write> c: array<f32>;

      @compute @workgroup_size(16, 16)
      fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
        let row = gid.x;
        let col = gid.y;
        if (row >= ${MATRIX_SIZE}u || col >= ${MATRIX_SIZE}u) { return; }

        var sum: f32 = 0.0;
        for (var k = 0u; k < ${MATRIX_SIZE}u; k = k + 1u) {
          sum = sum + a[row * ${MATRIX_SIZE}u + k] * b[k * ${MATRIX_SIZE}u + col];
        }
        c[row * ${MATRIX_SIZE}u + col] = sum;
      }
    `

    const module = device.createShaderModule({ code: shaderCode })
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    })

    const size = MATRIX_SIZE * MATRIX_SIZE
    const bufA = device.createBuffer({ size: size * 4, usage: 34 })
    const bufB = device.createBuffer({ size: size * 4, usage: 34 })
    const bufC = device.createBuffer({ size: size * 4, usage: 34 })

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bufA } },
        { binding: 1, resource: { buffer: bufB } },
        { binding: 2, resource: { buffer: bufC } },
      ],
    })

    let iterations = 0
    const start = performance.now()
    const endTime = start + durationMs

    while (performance.now() < endTime) {
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindGroup)
      const wgSize = Math.ceil(MATRIX_SIZE / 16)
      pass.dispatchWorkgroups(wgSize, wgSize)
      pass.end()
      device.queue.submit([encoder.finish()])
      iterations++
    }

    await device.queue.onSubmittedWorkDone()
    const elapsed = (performance.now() - start) / 1000
    const gflops = (2 * MATRIX_SIZE * MATRIX_SIZE * MATRIX_SIZE * iterations) / elapsed / 1e9
    return Math.round(gflops * 100) / 100
  } catch {
    return null
  }
}

async function start() {
  isRunning.value = true
  benchmark.isRunning = true
  benchmark.runningType = 'gpu'

  const startTime = performance.now()
  let finalMetrics: Record<string, number> = {}

  try {
    // Phase 1: WebGPU compute (if available)
    progressPhase.value = 'WebGPU matrix compute (2048x2048)'
    progressPercent.value = 5
    liveValue.value = 'Detecting WebGPU...'
    await nextTick()

    const wgGflops = await runWebGPUCompute(4000)
    if (wgGflops !== null) {
      liveValue.value = `${wgGflops} GFLOPS`
      progressPhase.value = `WebGPU: ${wgGflops} GFLOPS`
      progressPercent.value = 30
    } else {
      progressPhase.value = 'WebGPU not available, using WebGL'
      progressPercent.value = 30
    }

    // Phase 2: WebGL 4K instanced rendering — REAL GPU burn
    progressPhase.value = 'WebGL 4K burn-in (10k instances, heavy shader)'
    progressPercent.value = 35
    liveValue.value = 'Burning GPU...'
    await nextTick()

    const gl4k = createWebGLContext(3840, 2160)
    const mpix4k = runGpuBurn(gl4k, 5000)
    liveValue.value = `${mpix4k.toLocaleString()} MPix/s`
    progressPhase.value = `4K: ${mpix4k.toLocaleString()} MPix/s`
    progressPercent.value = 70

    // Phase 3: Memory bandwidth
    progressPhase.value = 'GPU memory bandwidth (texture thrash)'
    progressPercent.value = 75
    await nextTick()

    const texGl = createWebGLContext(8192, 8192)
    const tex = texGl.createTexture()!
    texGl.bindTexture(texGl.TEXTURE_2D, tex)
    const texData = new Uint8Array(8192 * 8192 * 4)
    for (let i = 0; i < texData.length; i++) texData[i] = i & 0xff

    const bwStart = performance.now()
    let uploads = 0
    while (performance.now() - bwStart < 3000) {
      texGl.texImage2D(texGl.TEXTURE_2D, 0, texGl.RGBA, 8192, 8192, 0, texGl.RGBA, texGl.UNSIGNED_BYTE, texData)
      uploads++
    }
    const gpuBandwidth = (uploads * 8192 * 8192 * 4) / ((performance.now() - bwStart) / 1000) / (1024 * 1024 * 1024)

    progressPercent.value = 100
    liveValue.value = ''
    progressPhase.value = 'Complete'

    finalMetrics = {
      gpuMpixPerSec: mpix4k,
      gpuBandwidthGBps: Math.round(gpuBandwidth * 100) / 100,
      webGpuGflops: wgGflops || 0,
      duration: Math.round(performance.now() - startTime),
    }

    // Score: based on megapixels/sec throughput
    // Reference: 100,000 MPix/s is roughly RTX 3060 level at this workload
    const score = calculateGpuScore({
      ...finalMetrics,
      fps1080p: 0, // not used anymore, but keep compat
      fps720p: 0,
    })
    benchmark.setResult({
      type: 'gpu', score,
      metrics: finalMetrics,
      duration: finalMetrics.duration,
    })
  } catch (e: any) {
    console.error('GPU benchmark error:', e)
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
        <p class="page-subtitle">WebGPU compute + WebGL 4K instanced rendering + 8K texture bandwidth</p>
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
        <div v-if="result.metrics.gpuMpixPerSec" class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ (result.metrics.gpuMpixPerSec / 1000).toFixed(1) }}G</div>
          <div class="text-xs text-gray-400">GPU GPix/s</div>
        </div>
        <div v-if="result.metrics.webGpuGflops" class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ result.metrics.webGpuGflops }}</div>
          <div class="text-xs text-gray-400">WebGPU GFLOPS</div>
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
