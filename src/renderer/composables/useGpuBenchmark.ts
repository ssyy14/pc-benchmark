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

// ─── Geometry Phase Shaders ──────────────────────────────
const GEO_VERT = `#version 300 es
in vec3 aP;
uniform mat4 uMVP;
out vec3 vC;
void main() {
  gl_Position = uMVP * vec4(aP, 1);
  vC = aP * 0.5 + 0.5;
}
`

const GEO_FRAG = `#version 300 es
precision highp float;
in vec3 vC;
out vec4 o;
void main() {
  // Minimal work — bottleneck is on geometry
  o = vec4(vC, 1);
}
`

// ─── Phase 2: Geometry Throughput ───────────────────────
async function runGeometryPhase(
  canvas: HTMLCanvasElement,
  durationMs: number,
): Promise<PhaseResult> {
  const TRI_COUNT = 500_000

  // Generate random micro-triangles
  const positions = new Float32Array(TRI_COUNT * 3 * 3) // 3 verts * 3 coords
  for (let i = 0; i < TRI_COUNT; i++) {
    // Random center in clip space, small offset
    const cx = (Math.random() - 0.5) * 2  // [-1, 1]
    const cy = (Math.random() - 0.5) * 2
    // Tiny triangle: ~0.002 in clip space = ~2 pixels at 1080p
    const s = 0.001 + Math.random() * 0.003
    const base = i * 9
    positions[base]     = cx
    positions[base + 1] = cy
    positions[base + 2] = Math.random() // z for depth variety
    positions[base + 3] = cx + s
    positions[base + 4] = cy
    positions[base + 5] = Math.random()
    positions[base + 6] = cx
    positions[base + 7] = cy + s
    positions[base + 8] = Math.random()
  }

  return runPhase(
    canvas,
    {
      width: 1920,
      height: 1080,
      setupGL(gl) {
        const vs = gl.createShader(gl.VERTEX_SHADER)!
        gl.shaderSource(vs, GEO_VERT)
        gl.compileShader(vs)

        const fs = gl.createShader(gl.FRAGMENT_SHADER)!
        gl.shaderSource(fs, GEO_FRAG)
        gl.compileShader(fs)

        const prog = gl.createProgram()!
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.linkProgram(prog)
        gl.useProgram(prog)

        // Upload triangle data
        const buf = gl.createBuffer()!
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)

        const aP = gl.getAttribLocation(prog, 'aP')
        gl.enableVertexAttribArray(aP)
        gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0)

        gl.enable(gl.DEPTH_TEST)

        ;(gl as any).__uMVP = gl.getUniformLocation(prog, 'uMVP')
        ;(gl as any).__geoProg = prog
      },
      drawFrame(gl, now, draws) {
        // Rotate MVP over time to stress vertex transform
        const angle = now * 0.0003
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        // Simple ortho-ish with rotation for vertex stress
        const mvp = new Float32Array([
          cos, sin * 0.3, 0, 0,
          -sin * 0.3, cos, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ])
        gl.uniformMatrix4fv((gl as any).__uMVP, false, mvp)
        gl.drawArrays(gl.TRIANGLES, 0, TRI_COUNT * 3)
      },
      computeMetric(totalDraws, _w, _h, elapsed) {
        // Each draw call renders TRI_COUNT*3 vertices = TRI_COUNT triangles
        const totalTriangles = TRI_COUNT * totalDraws
        return {
          phase: 'geometry',
          metric: 'geometryMTri',
          value: Math.round(totalTriangles / 1_000_000 / elapsed), // MTri/s
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
