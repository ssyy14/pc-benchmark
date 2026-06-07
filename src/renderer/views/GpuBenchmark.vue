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

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return s
}

const HEAVY_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;
uniform float uTime;
uniform vec2 uResolution;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

float noise(vec2 p) {
  vec2 i=floor(p); vec2 f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}

float fbm(vec2 p) {
  float v=0.0,a=0.5;
  for(int i=0;i<8;i++){ v+=a*noise(p); p*=2.3; a*=0.55; }
  return v;
}

void main() {
  vec2 uv=vUV*(uResolution/min(uResolution.x,uResolution.y));
  float n0=fbm(uv*3.0+uTime*0.05);
  float n1=fbm(uv*5.0+uTime*0.1+n0);
  float n2=fbm(uv*7.0-uTime*0.07+n1*0.5);

  // Volumetric lighting
  float vol=0.0;
  for(int s=0;s<10;s++){ float t=float(s)*0.15; vol+=noise((uv*2.0-1.0+uTime*0.2)*t*3.0)*exp(-t*2.0); }
  vol*=0.12;

  vec3 normal=normalize(vec3(
    fbm(uv*4.0+vec2(0.005,0))-fbm(uv*4.0-vec2(0.005,0)),
    fbm(uv*4.0+vec2(0,0.005))-fbm(uv*4.0-vec2(0,0.005)),0.02));

  vec3 ld=normalize(vec3(sin(uTime)*3.0,cos(uTime*0.7)*3.0,4.0)-vec3(uv*4.0-2.0,2.0));
  float dif=max(dot(normal,ld),0.0);
  float spec=pow(max(dot(reflect(-ld,normal),vec3(0,0,1)),0.0),64.0);
  float ao=1.0-n2*0.4;
  float fr=pow(1.0-abs(normal.z),4.0);

  vec3 col=mix(vec3(0.05,0.06,0.09),mix(vec3(0.8,0.5,0.2),vec3(0.2,0.5,0.9),sin(uv.x*20.0+n0*3.0)*0.5+0.5),fr*(0.5+n0*0.5));
  col+=(dif*vec3(1.0,0.85,0.6))*ao*0.4;
  col+=spec*vec3(1.0,0.9,0.7)*0.5;
  col+=vol*vec3(1.0,0.9,0.85);
  col+=n0*vec3(0.1,0.05,0.15)*0.2;
  col+=n2*vec3(0.15,0.1,0.05)*0.15;
  col+=hash(uv*uResolution+uTime)*0.03;
  col*=1.0-length(vUV-0.5)*0.5;
  col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);
  col=pow(col,vec3(1.0/2.2));
  fragColor=vec4(col,1.0);
}`

const VERT_SRC = `#version 300 es
in vec2 aPos; in vec2 aUV;
out vec2 vUV;
void main() { vUV=aUV; gl_Position=vec4(aPos,0,1); }`

// Non-blocking GPU burn: rAF + 100 draws/frame + gl.finish()
function runGpuBurn(gl: WebGL2RenderingContext, durationMs: number): Promise<number> {
  const prog = gl.createProgram()!
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VERT_SRC))
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, HEAVY_FRAG))
  gl.linkProgram(prog)

  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  const aUV = gl.getAttribLocation(prog, 'aUV')
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8)
  gl.useProgram(prog)
  const uTime = gl.getUniformLocation(prog, 'uTime')
  const uRes = gl.getUniformLocation(prog, 'uResolution')
  gl.uniform2f(uRes, gl.canvas.width, gl.canvas.height)

  let draws = 0
  const start = performance.now()
  const endTime = start + durationMs

  return new Promise(resolve => {
    function frame() {
      const now = performance.now()
      if (now >= endTime) {
        const elapsed = (now - start) / 1000
        const mpix = (gl.canvas.width * gl.canvas.height * draws) / 1_000_000
        resolve(Math.round(mpix / elapsed))
        return
      }
      // 200 draws per rAF = massive GPU work, UI still responsive
      for (let i = 0; i < 200; i++) {
        draws++
        gl.uniform1f(uTime, now * 0.001 + i * 0.01)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      gl.finish() // force GPU pipeline drain — ensures GPU actually works
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

// Texture upload bandwidth: chunks of 8K textures in rAF loop
function runTexBandwidth(gl: WebGL2RenderingContext, durationMs: number): Promise<number> {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  const data = new Uint8Array(8192 * 8192 * 4)
  for (let i = 0; i < data.length; i++) data[i] = i & 0xff

  let uploads = 0
  const start = performance.now()
  const endTime = start + durationMs

  return new Promise(resolve => {
    function frame() {
      if (performance.now() >= endTime) {
        const bw = (uploads * 8192 * 8192 * 4) / ((performance.now() - start) / 1000) / (1024**3)
        resolve(Math.round(bw * 100) / 100)
        return
      }
      // 4 uploads per frame
      for (let i = 0; i < 4; i++) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 8192, 8192, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
        uploads++
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

async function start() {
  isRunning.value = true
  benchmark.isRunning = true
  benchmark.runningType = 'gpu'
  const startTime = performance.now()
  let finalMetrics: Record<string, number> = {}

  try {
    // Phase 1: 4K GPU burn
    progressPhase.value = '4K GPU burn-in (200 draws/frame, gl.finish)'
    progressPercent.value = 10
    liveValue.value = 'Burning GPU...'
    await nextTick()

    const gl4k = createGL(3840, 2160)
    const mpix4k = runGpuBurn(gl4k, 6000)

    // Phase 2: 8K texture bandwidth (start in parallel)
    progressPhase.value = '8K texture bandwidth'
    progressPercent.value = 25
    await nextTick()

    const texGl = createGL(4096, 4096) // smaller for bandwidth, more uploads
    const bwPromise = runTexBandwidth(texGl, 4000)

    const gpuMpix = await mpix4k
    liveValue.value = `${(gpuMpix / 1000).toFixed(1)} GPix/s`
    progressPhase.value = `4K: ${(gpuMpix / 1000).toFixed(1)} GPix/s`
    progressPercent.value = 70

    const gpuBW = await bwPromise
    progressPercent.value = 100
    liveValue.value = ''
    progressPhase.value = 'Complete'

    finalMetrics = {
      gpuMpixPerSec: gpuMpix,
      gpuBandwidthGBps: gpuBW,
      duration: Math.round(performance.now() - startTime),
    }

    benchmark.setResult({
      type: 'gpu',
      score: calculateGpuScore(finalMetrics),
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

onUnmounted(() => { window.benchmarkAPI?.removeProgressListener() })
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">🎮 {{ $t('nav.gpu') }}</h2>
        <p class="page-subtitle">4K GPU burn-in: 200 heavy-shader draws/frame + gl.finish() + 8K texture bandwidth</p>
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
      <div class="grid grid-cols-2 gap-4 mt-4 text-center">
        <div v-if="result.metrics.gpuMpixPerSec" class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ (result.metrics.gpuMpixPerSec / 1000).toFixed(1) }}G</div>
          <div class="text-xs text-gray-400">GPU GPix/s</div>
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
