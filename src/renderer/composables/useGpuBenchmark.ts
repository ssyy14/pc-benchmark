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

// ─── Compute Phase Shaders ───────────────────────────────
const COMP_VERT = `#version 300 es
in vec2 aP;
in vec2 aUV;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aP, 0, 1);
}
`

const COMP_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform float uTime;
uniform vec2 uRes;

// Enhanced procedural shader — more math than original
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 12; i++) { v += a * noise(p); p *= 2.3; a *= 0.52; }
  return v;
}

void main() {
  vec2 uv = vUV * (uRes / min(uRes.x, uRes.y));
  float n0 = fbm(uv * 4.0 + uTime * 0.05);
  float n1 = fbm(uv * 6.0 + uTime * 0.12 + n0);
  float n2 = fbm(uv * 8.0 - uTime * 0.08 + n1 * 0.5);
  float n3 = fbm(uv * 10.0 + uTime * 0.03 + n2 * 0.3);

  // Volumetric accumulation — 15 steps (was 10)
  float vol = 0.0;
  for (int s = 0; s < 15; s++) {
    float t = float(s) * 0.12;
    vol += noise((uv * 2.0 - 1.0 + uTime * 0.25) * t * 3.5) * exp(-t * 2.0);
  }
  vol *= 0.1;

  // Multi-frequency normals
  vec3 N = normalize(vec3(
    fbm(uv * 5.0 + vec2(.005, 0)) - fbm(uv * 5.0 - vec2(.005, 0)),
    fbm(uv * 5.0 + vec2(0, .005)) - fbm(uv * 5.0 - vec2(0, .005)),
    .02
  ));

  // Multiple lights
  vec3 L0 = normalize(vec3(sin(uTime) * 3.0, cos(uTime * .7) * 3.0, 4.0) - vec3(uv * 4.0 - 2.0, 2.0));
  vec3 L1 = normalize(vec3(cos(uTime * 1.3) * 2.0, sin(uTime * .5) * 2.0, 3.0) - vec3(uv * 3.0 - 1.0, 1.5));
  float dif = max(dot(N, L0), 0.0) * .35 + max(dot(N, L1), 0.0) * .15;
  float sp = pow(max(dot(reflect(-L0, N), vec3(0, 0, 1)), 0.0), 64.0) * .4;
  float ao = 1.0 - n2 * .45;

  vec3 metal = mix(
    mix(vec3(.8, .5, .2), vec3(.2, .5, .9), sin(uv.x * 25.0 + n0 * 3.0) * .5 + .5),
    mix(vec3(.3, .6, .4), vec3(.7, .3, .5), cos(uv.y * 25.0 + n1 * 3.0) * .5 + .5),
    n3
  );

  vec3 col = mix(vec3(.05, .06, .09), metal, .4 + n0 * .5);
  col += dif * vec3(1.0, .85, .6) * ao;
  col += sp * vec3(1.0, .9, .7);
  col += vol * vec3(1.0, .95, .85);
  col += n0 * vec3(.15, .1, .25) * .2;
  col += n1 * vec3(.05, .15, .1) * .12;
  col += n2 * vec3(.2, .05, .1) * .12;
  col += n3 * vec3(.1, .08, .2) * .08;
  col += hash(uv * uRes + uTime) * .02;
  col *= 1.0 - length(vUV - .5) * .35;

  // HDR tone mapping
  col = (col * (2.51 * col + .03)) / (col * (2.43 * col + .59) + .14);
  col = pow(col, vec3(1. / 2.2));
  o = vec4(col, 1.0);
}
`

// ─── Phase 3: Compute / Shader Math ─────────────────────
async function runComputePhase(
  canvas: HTMLCanvasElement,
  durationMs: number,
): Promise<PhaseResult> {
  const quadUV = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1])

  return runPhase(
    canvas,
    {
      width: 3840,
      height: 2160,
      setupGL(gl) {
        const vs = gl.createShader(gl.VERTEX_SHADER)!
        gl.shaderSource(vs, COMP_VERT)
        gl.compileShader(vs)

        const fs = gl.createShader(gl.FRAGMENT_SHADER)!
        gl.shaderSource(fs, COMP_FRAG)
        gl.compileShader(fs)

        const prog = gl.createProgram()!
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.linkProgram(prog)
        gl.useProgram(prog)

        const buf = gl.createBuffer()!
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, quadUV, gl.STATIC_DRAW)

        const aP = gl.getAttribLocation(prog, 'aP')
        gl.enableVertexAttribArray(aP)
        gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 16, 0)

        const aUV = gl.getAttribLocation(prog, 'aUV')
        gl.enableVertexAttribArray(aUV)
        gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8)

        gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), 3840, 2160)

        ;(gl as any).__uTime = gl.getUniformLocation(prog, 'uTime')
      },
      drawFrame(gl, now, draws) {
        gl.uniform1f((gl as any).__uTime, now * 0.001 + draws * 0.005)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      },
      computeMetric(totalDraws, w, h, elapsed) {
        const mpix = (w * h * totalDraws) / 1_000_000
        return {
          phase: 'compute',
          metric: 'computeMPix',
          value: Math.round(mpix / elapsed),
        }
      },
    },
    durationMs,
  )
}

// ─── Bandwidth Phase Shaders ─────────────────────────────
const BW_VERT = `#version 300 es
in vec2 aP;
in vec2 aUV;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aP, 0, 1);
}
`

const BW_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex0;
uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform sampler2D uTex3;
uniform float uTime;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float t = uTime * 0.01;
  // Jittered UV for cache-unfriendly access
  vec2 uv0 = vUV + vec2(hash(vUV + t) - 0.5, hash(vUV - t) - 0.5) * 0.04;
  vec2 uv1 = vUV + vec2(hash(vUV * 2.0 + t) - 0.5, hash(vUV * 3.0 - t) - 0.5) * 0.04;
  vec2 uv2 = vUV + vec2(hash(vUV * 4.0 + t * 2.0) - 0.5, hash(vUV * 5.0 - t * 2.0) - 0.5) * 0.04;
  vec2 uv3 = vUV + vec2(hash(vUV * 6.0 + t * 3.0) - 0.5, hash(vUV * 7.0 - t * 3.0) - 0.5) * 0.04;

  // Multiple samples per texture for cache pressure
  vec4 s0a = texture(uTex0, uv0);
  vec4 s0b = texture(uTex0, uv0 + 0.008);
  vec4 s0c = texture(uTex0, uv0 - 0.004);
  vec4 s1a = texture(uTex1, uv1);
  vec4 s1b = texture(uTex1, uv1 + 0.006);
  vec4 s2a = texture(uTex2, uv2);
  vec4 s2b = texture(uTex2, uv2 - 0.005);
  vec4 s3a = texture(uTex3, uv3);
  vec4 s3b = texture(uTex3, uv3 + 0.007);

  // Write to all 4 color attachments
  o0 = s0a * s0b + s0c;
  o1 = s1a * s1b + s0a * 0.2;
  o2 = s2a * s2b + s1a * 0.3;
  o3 = s3a * s3b + s2a * 0.4;
}
`

// ─── Phase 4: Memory Bandwidth (MRT) ────────────────────
async function runBandwidthPhase(
  canvas: HTMLCanvasElement,
  durationMs: number,
): Promise<PhaseResult> {
  const W = 2560
  const H = 1440
  const TEX = 4096
  const quadUV = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1])

  return new Promise((resolve, reject) => {
    try {
      canvas.width = W
      canvas.height = H
      const gl = canvas.getContext('webgl2', {
        powerPreference: 'high-performance',
        antialias: false,
        desynchronized: true,
      })
      if (!gl) throw new Error('WebGL2 unavailable')

      // Compile shaders
      const vs = gl.createShader(gl.VERTEX_SHADER)!
      gl.shaderSource(vs, BW_VERT)
      gl.compileShader(vs)

      const fs = gl.createShader(gl.FRAGMENT_SHADER)!
      gl.shaderSource(fs, BW_FRAG)
      gl.compileShader(fs)

      const prog = gl.createProgram()!
      gl.attachShader(prog, vs)
      gl.attachShader(prog, fs)
      gl.linkProgram(prog)
      gl.useProgram(prog)

      // Upload quad
      const buf = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, quadUV, gl.STATIC_DRAW)
      const aP = gl.getAttribLocation(prog, 'aP')
      gl.enableVertexAttribArray(aP)
      gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 16, 0)
      const aUV = gl.getAttribLocation(prog, 'aUV')
      gl.enableVertexAttribArray(aUV)
      gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 16, 8)

      // Generate 4 noise textures (4096x4096 RGBA each = 256 MB total)
      const textures: WebGLTexture[] = []
      for (let t = 0; t < 4; t++) {
        const tex = gl.createTexture()!
        gl.activeTexture(gl.TEXTURE0 + t)
        gl.bindTexture(gl.TEXTURE_2D, tex)

        // Generate noise data on CPU
        const size = TEX * TEX * 4
        const data = new Uint8Array(size)
        for (let i = 0; i < size; i++) {
          data[i] = ((i * 1103515245 + 12345 + t * 98765) & 0x7fffffff) % 256
        }

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX, TEX, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
        gl.generateMipmap(gl.TEXTURE_2D)

        textures.push(tex)
      }
      // Bind sampler uniforms
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex0'), 0)
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex1'), 1)
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex2'), 2)
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex3'), 3)

      const uTimeLoc = gl.getUniformLocation(prog, 'uTime')

      // Create FBO with 4 color attachments
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)

      const colorTargets: WebGLTexture[] = []
      const attachmentPoints: number[] = []
      for (let i = 0; i < 4; i++) {
        const colorTex = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, colorTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, colorTex, 0)
        colorTargets.push(colorTex)
        attachmentPoints.push(gl.COLOR_ATTACHMENT0 + i)
      }
      gl.drawBuffers(attachmentPoints)

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        reject(new Error('MRT framebuffer incomplete'))
        return
      }

      (gl as any).__uTimeLoc = uTimeLoc
      ;(gl as any).__bwProg = prog

      // Per-draw data size for metric calculation
      const BYTES_PER_PIXEL_PER_DRAW = 48 // 32 read + 16 write

      let totalDrawCalls = 0
      const start = performance.now()
      const endTime = start + durationMs

      const frame = () => {
        try {
          const now = performance.now()
          if (now >= endTime) {
            const elapsed = (now - start) / 1000
            const totalBytes = totalDrawCalls * W * H * BYTES_PER_PIXEL_PER_DRAW
            const gbps = totalBytes / 1_000_000_000 / elapsed
            resolve({
              phase: 'bandwidth',
              metric: 'bandwidthGBps',
              value: Math.round(gbps),
            })
            return
          }
          // Draw many passes — each stresses texture read + MRT write
          for (let i = 0; i < 150; i++) {
            totalDrawCalls++
            gl.uniform1f(uTimeLoc, now + i * 0.01)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
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
