// Composable: Real WebGL GPU benchmark that runs in the renderer process
// Extracted from GpuBenchmark.vue so it can be used from both individual page and "Run All"

import { ref, nextTick } from 'vue'
import { useBenchmarkStore } from '../stores/benchmark'
import { calculateGpuScore } from '../utils/scoring'

export interface GpuBenchmarkState {
  isRunning: ReturnType<typeof ref<boolean>>
  progressPercent: ReturnType<typeof ref<number>>
  progressPhase: ReturnType<typeof ref<string>>
  liveValue: ReturnType<typeof ref<string>>
  canvasRef: ReturnType<typeof ref<HTMLCanvasElement | null>>
}

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

  float vol=0.0;
  for(int s=0;s<10;s++){float t=float(s)*0.15;vol+=noise((uv*2.0-1.0+uTime*0.2)*t*3.0)*exp(-t*2.0);}
  vol*=0.12;

  vec3 N=normalize(vec3(fbm(uv*4.0+vec2(.005,0))-fbm(uv*4.0-vec2(.005,0)),fbm(uv*4.0+vec2(0,.005))-fbm(uv*4.0-vec2(0,.005)),.02));
  vec3 L=normalize(vec3(sin(uTime)*3.0,cos(uTime*.7)*3.0,4.0)-vec3(uv*4.0-2.0,2.0));
  float dif=max(dot(N,L),0.0)*.4;
  float sp=pow(max(dot(reflect(-L,N),vec3(0,0,1)),0.0),64.0)*.5;
  float ao=1.0-n2*.4;
  float fr=pow(1.0-abs(N.z),4.0);

  vec3 metal=mix(vec3(.8,.5,.2),vec3(.2,.5,.9),sin(uv.x*20.0+n0*3.0)*.5+.5);
  vec3 col=mix(vec3(.05,.06,.09),metal,fr*(.5+n0*.5));

  col+=dif*vec3(1.0,.85,.6)*ao;
  col+=sp*vec3(1.0,.9,.7);
  col+=vol*vec3(1.0,.95,.85);
  col+=n0*vec3(.15,.1,.25)*.15;
  col+=n1*vec3(.05,.15,.1)*.1;
  col+=n2*vec3(.2,.05,.1)*.1;
  col+=hash(uv*uRes+uTime)*.02;
  col*=1.0-length(vUV-.5)*.4;

  col=(col*(2.51*col+.03))/(col*(2.43*col+.59)+.14);
  col=pow(col,vec3(1./2.2));
  o=vec4(col,1.0);
}`

const VERT = `#version 300 es
in vec2 aP; in vec2 aUV; out vec2 vUV;
void main(){vUV=aUV;gl_Position=vec4(aP,0,1);}`

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src); gl.compileShader(s)
  return s
}

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

export function useGpuBenchmark() {
  const benchmark = useBenchmarkStore()
  const isRunning = ref(false)
  const progressPercent = ref(0)
  const progressPhase = ref('')
  const liveValue = ref('')
  const canvasRef = ref<HTMLCanvasElement | null>(null)

  function getGL(canvas: HTMLCanvasElement, width: number, height: number): WebGL2RenderingContext {
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

  async function run(canvas?: HTMLCanvasElement): Promise<void> {
    isRunning.value = true; benchmark.isRunning = true; benchmark.runningType = 'gpu'
    const startTime = performance.now()
    let usedCanvas: HTMLCanvasElement | null = null

    try {
      progressPhase.value = '4K GPU Burn-in — watch the shader!'
      progressPercent.value = 10
      liveValue.value = 'Initializing...'
      await nextTick()  // Wait for v-if to render the canvas

      usedCanvas = canvas || canvasRef.value
      if (!usedCanvas) throw new Error('No canvas available')
      const gl = getGL(usedCanvas, 3840, 2160)
      progressPercent.value = 15

      const mpix = await runGpuBurn(gl, 6000)
      liveValue.value = `${(mpix / 1000).toFixed(1)} GPix/s`
      progressPercent.value = 100
      progressPhase.value = 'Complete'
      liveValue.value = ''

      const fm = { gpuMpixPerSec: mpix, gpuBandwidthGBps: 0, duration: Math.round(performance.now() - startTime) }
      benchmark.setResult({ type: 'gpu', score: calculateGpuScore(fm), metrics: fm, duration: fm.duration })
    } catch (e: any) {
      console.error('GPU benchmark failed:', e)
      benchmark.setResult({ type: 'gpu', score: 0, metrics: {}, duration: 0, skipped: true })
    } finally {
      isRunning.value = false; benchmark.isRunning = false; benchmark.runningType = null
      if (usedCanvas) usedCanvas.style.display = 'none'
    }
  }

  return { isRunning, progressPercent, progressPhase, liveValue, canvasRef, run }
}
