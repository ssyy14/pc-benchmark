// Composable: 4-phase GPU benchmark
import { ref, nextTick } from 'vue'
import { useBenchmarkStore } from '../stores/benchmark'
import { calculateGpuScore } from '../utils/scoring'

// ─── Fillrate Phase Shaders ──────────────────────────────
const FILL_VERT = `#version 300 es
in vec2 aP;
void main() { gl_Position = vec4(aP, 0, 1); }
`

const FILL_FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform float uAlpha;
void main() {
  o = vec4(0.5, 0.2, 0.8, uAlpha);
}
`

// ─── Phase Runner Types ──────────────────────────────────
interface PhaseResult {
  phase: string
  metric: string
  value: number
}

interface PhaseOption {
  width: number
  height: number
  setupGL: (gl: WebGL2RenderingContext) => void
  drawFrame: (gl: WebGL2RenderingContext, now: number, draws: number) => void
  computeMetric: (totalDrawCalls: number, width: number, height: number, elapsedSec: number) => PhaseResult
}

function runPhase(
  canvas: HTMLCanvasElement,
  opt: PhaseOption,
  durationMs: number,
): Promise<PhaseResult> {
  return new Promise((resolve, reject) => {
    try {
      canvas.width = opt.width
      canvas.height = opt.height
      const gl = canvas.getContext('webgl2', {
        powerPreference: 'high-performance',
        antialias: false,
        desynchronized: true,
      })
      if (!gl) throw new Error('WebGL2 unavailable')

      opt.setupGL(gl)

      let totalDrawCalls = 0
      const start = performance.now()
      const endTime = start + durationMs

      const frame = () => {
        try {
          const now = performance.now()
          if (now >= endTime) {
            const elapsed = (now - start) / 1000
            resolve(opt.computeMetric(totalDrawCalls, opt.width, opt.height, elapsed))
            return
          }
          // Batch 250 draws per frame
          for (let i = 0; i < 250; i++) {
            totalDrawCalls++
            opt.drawFrame(gl, now, totalDrawCalls)
          }
          gl.finish()
          requestAnimationFrame(frame)
        } catch (e) {
          reject(e)
        }
      }
      requestAnimationFrame(frame)
    } catch (e) {
      reject(e)
    }
  })
}

// ─── Phase 1: Fillrate ──────────────────────────────────
async function runFillratePhase(
  canvas: HTMLCanvasElement,
  durationMs: number,
): Promise<PhaseResult> {
  // Generate full-screen quad geometry
  const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])

  return runPhase(
    canvas,
    {
      width: 3840,
      height: 2160,
      setupGL(gl) {
        // Compile shaders
        const vs = gl.createShader(gl.VERTEX_SHADER)!
        gl.shaderSource(vs, FILL_VERT)
        gl.compileShader(vs)

        const fs = gl.createShader(gl.FRAGMENT_SHADER)!
        gl.shaderSource(fs, FILL_FRAG)
        gl.compileShader(fs)

        const prog = gl.createProgram()!
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.linkProgram(prog)
        gl.useProgram(prog)

        // Setup geometry
        const buf = gl.createBuffer()!
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW)
        const aP = gl.getAttribLocation(prog, 'aP')
        gl.enableVertexAttribArray(aP)
        gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0)

        // Alpha blending for overdraw pressure
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

        // Store uniform location
        ;(gl as any).__uAlpha = gl.getUniformLocation(prog, 'uAlpha')
      },
      drawFrame(gl, now, draws) {
        // Subtly vary alpha so driver can't optimize away blending
        gl.uniform1f((gl as any).__uAlpha, 0.04 + Math.sin(draws * 0.1) * 0.01)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      },
      computeMetric(totalDraws, w, h, elapsed) {
        const mpix = (w * h * totalDraws) / 1_000_000
        return {
          phase: 'fillrate',
          metric: 'fillrateMPix',
          value: Math.round(mpix / elapsed),
        }
      },
    },
    durationMs,
  )
}

// ─── Exports ─────────────────────────────────────────────
export function useGpuBenchmark() {
  const benchmark = useBenchmarkStore()
  const isRunning = ref(false)
  const progressPercent = ref(0)
  const progressPhase = ref('')
  const liveValue = ref('')
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const currentPhaseIndex = ref(-1)

  async function run(canvas?: HTMLCanvasElement): Promise<void> {
    // TODO: full orchestrator — Task 6
    console.log('Only Phase 1 wired for now')
  }

  return { isRunning, progressPercent, progressPhase, liveValue, canvasRef, currentPhaseIndex, run }
}
