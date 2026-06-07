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
const canvasRef = ref<HTMLCanvasElement | null>(null)
const showingPreview = ref(false)

function getGL(width: number, height: number): WebGL2RenderingContext {
  const canvas = canvasRef.value!
  canvas.width = width
  canvas.height = height
  canvas.style.display = 'block'
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
  gl.shaderSource(s, src); gl.compileShader(s)
  return s
}

// Beautiful procedural shader with rich colors
const FRAG = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform float uTime; uniform vec2 uRes;

float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<8;i++){v+=a*noise(p);p*=2.3;a*=0.55;}return v;}

void main(){
  vec2 uv=vUV*(uRes/min(uRes.x,uRes.y));
  float n0=fbm(uv*3.0+uTime*0.05);
  float n1=fbm(uv*5.0+uTime*0.1+n0);
  float n2=fbm(uv*7.0-uTime*0.07+n1*0.5);

  // Volumetric "god rays"
  float vol=0.0;
  for(int s=0;s<10;s++){float t=float(s)*0.15;vol+=noise((uv*2.0-1.0+uTime*0.2)*t*3.0)*exp(-t*2.0);}
  vol*=0.12;

  // Normals from noise
  vec3 N=normalize(vec3(fbm(uv*4.0+vec2(.005,0))-fbm(uv*4.0-vec2(.005,0)),fbm(uv*4.0+vec2(0,.005))-fbm(uv*4.0-vec2(0,.005)),.02));
  vec3 L=normalize(vec3(sin(uTime)*3.0,cos(uTime*.7)*3.0,4.0)-vec3(uv*4.0-2.0,2.0));
  float dif=max(dot(N,L),0.0)*.4;
  float sp=pow(max(dot(reflect(-L,N),vec3(0,0,1)),0.0),64.0)*.5;
  float ao=1.0-n2*.4;
  float fr=pow(1.0-abs(N.z),4.0);

  // Iridescent metal
  vec3 metal=mix(vec3(.8,.5,.2),vec3(.2,.5,.9),sin(uv.x*20.0+n0*3.0)*.5+.5);
  vec3 col=mix(vec3(.05,.06,.09),metal,fr*(.5+n0*.5));

  // Lighting
  col+=dif*vec3(1.0,.85,.6)*ao;
  col+=sp*vec3(1.0,.9,.7);
  col+=vol*vec3(1.0,.95,.85);
  col+=n0*vec3(.15,.1,.25)*.15;
  col+=n1*vec3(.05,.15,.1)*.1;
  col+=n2*vec3(.2,.05,.1)*.1;
  col+=hash(uv*uRes+uTime)*.02; // grain
  col*=1.0-length(vUV-.5)*.4; // vignette

  // ACES tone map
  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
  col=pow(col,vec3(1./2.2));
  o=vec4(col,1.0);
}`

const VERT = `#version 300 es
in vec2 aP; in vec2 aUV; out vec2 vUV;
void main(){vUV=aUV;gl_Position=vec4(aP,0,1);}`

function runGpuBurn(gl: WebGL2RenderingContext, durationMs: number): Promise<number> {
  const p = gl.createProgram()!
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(p)

  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,0, 1,-1,1,0, -1,1,0,1, 1,1,1,1]), gl.STATIC_DRAW)
  const aP = gl.getAttribLocation(p, 'aP'), aUV = gl.getAttribLocation(p, 'aUV')
  gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 16, 0)
  gl.enableVertexAttribArray(aUV); gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8)
  gl.useProgram(p)
  const uT = gl.getUniformLocation(p, 'uTime'), uR = gl.getUniformLocation(p, 'uRes')
  gl.uniform2f(uR, gl.canvas.width, gl.canvas.height)

  let draws = 0
  const start = performance.now(), endTime = start + durationMs

  return new Promise(resolve => {
    function frame() {
      const now = performance.now()
      if (now >= endTime) {
        const mpix = (gl.canvas.width * gl.canvas.height * draws) / 1_000_000
        const elapsed = (now - start) / 1000
        resolve(Math.round(mpix / elapsed))
        return
      }
      // 200 draws per frame — the shader is what you see on screen!
      for (let i = 0; i < 200; i++) {
        draws++
        gl.uniform1f(uT, now * 0.001 + i * 0.01)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      gl.finish()
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

async function start() {
  isRunning.value = true; benchmark.isRunning = true; benchmark.runningType = 'gpu'
  showingPreview.value = true
  const startTime = performance.now()
  let fm: Record<string, number> = {}
  try {
    progressPhase.value = '4K GPU Burn-in — watch the shader!'; progressPercent.value = 10
    liveValue.value = 'Press Start to begin...'
    await nextTick()

    const gl = getGL(3840, 2160)
    progressPercent.value = 15

    const mpix = await runGpuBurn(gl, 6000)
    liveValue.value = `${(mpix / 1000).toFixed(1)} GPix/s`
    progressPercent.value = 100
    progressPhase.value = 'Complete'
    liveValue.value = ''; showingPreview.value = false

    fm = { gpuMpixPerSec: mpix, gpuBandwidthGBps: 0, duration: Math.round(performance.now() - startTime) }
    benchmark.setResult({ type: 'gpu', score: calculateGpuScore(fm), metrics: fm, duration: fm.duration })
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
        <h2 class="page-title">🎮 {{ $t('nav.gpu') }}</h2>
        <p class="page-subtitle">4K procedural shader burn-in — you can watch the rendering live!</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <!-- LIVE CANVAS PREVIEW -->
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
      <div class="grid grid-cols-1 gap-4 mt-4 text-center">
        <div v-if="result.metrics.gpuMpixPerSec" class="bench-card">
          <div class="text-2xl font-bold text-blue-600">{{ (result.metrics.gpuMpixPerSec / 1000).toFixed(1) }}G</div>
          <div class="text-xs text-gray-400">GPU GPix/s throughput</div>
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
