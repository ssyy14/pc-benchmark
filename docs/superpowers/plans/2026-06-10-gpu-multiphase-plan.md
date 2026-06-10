# GPU Multi-Phase Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shader 6-second GPU benchmark with a 4-phase pressure test (fillrate, geometry, compute, bandwidth) totaling ~25 seconds, producing per-phase metrics and a weighted composite score.

**Architecture:** Each phase has its own WebGL2 shader pair and a `run*Phase()` function in `useGpuBenchmark.ts`. An orchestrator `runAllPhases()` runs them sequentially, updating shared state (progress, phase name, live value) so the Vue component can display phase dots and live preview. Scoring in `scoring.ts` accepts the 4 new metric names with new references and weights.

**Tech Stack:** TypeScript, WebGL2 (ES 3.0 shaders), Vue 3 Composition API, Vitest

---

### Task 1: Update `calculateGpuScore` for 4-phase metrics

**Files:**
- Modify: `src/renderer/utils/scoring.ts:67-72`
- Modify: `src/renderer/utils/__tests__/scoring.test.ts` (add GPU score tests)

- [ ] **Step 1: Add GPU score tests to scoring.test.ts**

Add after the existing `calculateDiskScore` describe block:

```ts
import {
  normalizeScore,
  calculateCpuScore,
  calculateDiskScore,
  calculateGpuScore,       // <-- add to imports
  calculateOverallScore,
  getTier,
} from '../scoring'

// ... after calculateDiskScore describe block ...

describe('calculateGpuScore', () => {
  it('returns around 5000 for reference-level 4-phase GPU', () => {
    const score = calculateGpuScore({
      fillrateMPix: 80000,
      geometryMTri: 10000,
      computeMPix: 100000,
      bandwidthGBps: 80,
    })
    expect(score).toBeGreaterThan(4000)
    expect(score).toBeLessThan(6000)
  })

  it('weights compute phase most heavily', () => {
    // All low except compute
    const score = calculateGpuScore({
      fillrateMPix: 8000,    // 10% of ref -> ~500
      geometryMTri: 1000,     // 10% of ref -> ~500
      computeMPix: 100000,    // 100% of ref -> ~5000
      bandwidthGBps: 8,       // 10% of ref -> ~500
    })
    // compute is 30%, so it should push score noticeably above the 10% baseline
    expect(score).toBeGreaterThan(1500)
    expect(score).toBeLessThan(4000)
  })

  it('handles zero metrics gracefully', () => {
    const score = calculateGpuScore({
      fillrateMPix: 0,
      geometryMTri: 0,
      computeMPix: 0,
      bandwidthGBps: 0,
    })
    expect(score).toBe(0)
  })

  // Backward compatibility: old format still works
  it('falls back to old gpuMpixPerSec if new metrics missing', () => {
    const score = calculateGpuScore({
      gpuMpixPerSec: 100000,
      gpuBandwidthGBps: 80,
    })
    expect(score).toBeGreaterThan(4000)
    expect(score).toBeLessThan(6000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd C:/Users/r/pc-benchmark && npx vitest run src/renderer/utils/__tests__/scoring.test.ts
```

Expected: FAIL — `calculateGpuScore` not imported (if not already), or new metric handling not yet implemented.

- [ ] **Step 3: Rewrite `calculateGpuScore` in scoring.ts**

Replace lines 67-72 of `scoring.ts`:

```ts
export function calculateGpuScore(metrics: Record<string, number>): number {
  // New 4-phase metrics (multi-phase GPU benchmark)
  if (metrics.fillrateMPix !== undefined || metrics.geometryMTri !== undefined
    || metrics.computeMPix !== undefined || metrics.bandwidthGBps !== undefined) {

    const fillrate = normalizeScore(metrics.fillrateMPix || 0, 80_000)
    const geometry = normalizeScore(metrics.geometryMTri || 0, 10_000)
    const compute  = normalizeScore(metrics.computeMPix  || 0, 100_000)
    const bandwidth = normalizeScore(metrics.bandwidthGBps || 0, 80)

    return Math.round(
      fillrate  * 0.25 +
      geometry  * 0.25 +
      compute   * 0.30 +
      bandwidth * 0.20
    )
  }

  // Legacy fallback: old single-phase format
  const mpix = normalizeScore(metrics.gpuMpixPerSec || 0, 100_000)
  const bw   = normalizeScore(metrics.gpuBandwidthGBps || 0, 80)
  return Math.round(mpix * 0.70 + bw * 0.30)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd C:/Users/r/pc-benchmark && npx vitest run src/renderer/utils/__tests__/scoring.test.ts
```

Expected: All tests PASS (6 existing + 4 new = 10 passing).

- [ ] **Step 5: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/utils/scoring.ts src/renderer/utils/__tests__/scoring.test.ts
git commit -m "feat: update calculateGpuScore for 4-phase metrics with backward compat

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Build Phase 1 — Fillrate

**Files:**
- Modify: `src/renderer/composables/useGpuBenchmark.ts`

- [ ] **Step 1: Define fillrate shader sources and helper**

Replace the entire file content with the new composable skeleton, adding fillrate shaders and runner:

```ts
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

// ─── Fillrate Phase Runner ──────────────────────────────
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

export function useGpuBenchmark() {
  const benchmark = useBenchmarkStore()
  const isRunning = ref(false)
  const progressPercent = ref(0)
  const progressPhase = ref('')
  const liveValue = ref('')
  const canvasRef = ref<HTMLCanvasElement | null>(null)

  async function run(canvas?: HTMLCanvasElement): Promise<void> {
    // TODO: full orchestrator — Task 6
    console.log('Only Phase 1 wired for now')
  }

  return { isRunning, progressPercent, progressPhase, liveValue, canvasRef, run }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to `useGpuBenchmark.ts`.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/composables/useGpuBenchmark.ts
git commit -m "feat: add Phase 1 fillrate benchmark with generic phase runner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Build Phase 2 — Geometry

**Files:**
- Modify: `src/renderer/composables/useGpuBenchmark.ts`

- [ ] **Step 1: Add geometry shader sources and runner function**

Add after the fillrate shader definitions and before `export function useGpuBenchmark()`:

```ts
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/composables/useGpuBenchmark.ts
git commit -m "feat: add Phase 2 geometry benchmark with 500K micro-triangles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Build Phase 3 — Compute (Upgraded Shader)

**Files:**
- Modify: `src/renderer/composables/useGpuBenchmark.ts`

- [ ] **Step 1: Add compute shader sources and runner function**

Add after the geometry phase code, before `export function useGpuBenchmark()`:

```ts
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/composables/useGpuBenchmark.ts
git commit -m "feat: add Phase 3 compute benchmark with upgraded procedural shader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Build Phase 4 — Bandwidth (MRT)

**Files:**
- Modify: `src/renderer/composables/useGpuBenchmark.ts`

- [ ] **Step 1: Add bandwidth shader sources, texture generation, and runner function**

Add after Phase 3 code, before `export function useGpuBenchmark()`:

```ts
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
      // Reads: TEX*TEX*4 bytes * 4 textures * ~2 unique queries (some reused from cache)
      //   plus 8 texture samples per pixel * 4 bytes = 8 * 4 = 32 bytes/pixel reads
      // Writes: W*H * 4 color RTs * 4 bytes = W*H*16 bytes/pixel writes
      // Per-frame: drawCount * W * H * (32 + 16) bytes
      // We'll estimate 32 bytes read + 16 bytes write per pixel per draw for the metric
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/composables/useGpuBenchmark.ts
git commit -m "feat: add Phase 4 bandwidth benchmark with MRT and noise textures

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Build Orchestrator — Run All 4 Phases

**Files:**
- Modify: `src/renderer/composables/useGpuBenchmark.ts`

- [ ] **Step 1: Replace the skeleton `run()` function with the full orchestrator**

Replace the placeholder `run()` function inside `useGpuBenchmark()`:

```ts
  async function run(canvas?: HTMLCanvasElement): Promise<void> {
    isRunning.value = true
    benchmark.isRunning = true
    benchmark.runningType = 'gpu'

    const usedCanvas = canvas || canvasRef.value
    if (!usedCanvas) {
      isRunning.value = false
      benchmark.isRunning = false
      benchmark.runningType = null
      return
    }

    const startTime = performance.now()
    const phases: Array<{
      name: string
      icon: string
      fn: (c: HTMLCanvasElement, d: number) => Promise<PhaseResult>
      duration: number
    }> = [
      { name: 'Fillrate',   icon: '🔴', fn: runFillratePhase,   duration: 5000  },
      { name: 'Geometry',   icon: '🟡', fn: runGeometryPhase,   duration: 6000  },
      { name: 'Compute',    icon: '🟢', fn: runComputePhase,    duration: 8000  },
      { name: 'Bandwidth',  icon: '🔵', fn: runBandwidthPhase,  duration: 6000  },
    ]

    const metrics: Record<string, number> = {}

    try {
      for (let i = 0; i < phases.length; i++) {
        const ph = phases[i]
        const phaseStartPercent = (i / phases.length) * 100

        progressPhase.value = `${ph.icon} Phase ${i + 1}/4: ${ph.name}`
        progressPercent.value = phaseStartPercent
        liveValue.value = 'Initializing...'

        await nextTick()

        const result = await ph.fn(usedCanvas, ph.duration)
        metrics[result.metric] = result.value

        progressPercent.value = ((i + 1) / phases.length) * 100
        liveValue.value = `${result.value.toLocaleString()} ${result.metric === 'bandwidthGBps' ? 'GB/s' : result.metric === 'geometryMTri' ? 'MTri/s' : 'MPix/s'}`
      }

      progressPhase.value = 'Complete'
      liveValue.value = ''
      progressPercent.value = 100

      const duration = Math.round(performance.now() - startTime)
      benchmark.setResult({
        type: 'gpu',
        score: calculateGpuScore({ ...metrics, duration }),
        metrics: { ...metrics, duration },
        duration,
      })
    } catch (e: any) {
      console.error('GPU benchmark failed:', e)
      benchmark.setResult({ type: 'gpu', score: 0, metrics: {}, duration: 0, skipped: true })
    } finally {
      isRunning.value = false
      benchmark.isRunning = false
      benchmark.runningType = null
    }
  }
```

Also export the `currentPhaseIndex` ref so the UI can show phase dots. Add after the existing refs in `useGpuBenchmark()`:

```ts
  const currentPhaseIndex = ref(-1) // -1 = not running, 0-3 = active phase
```

And update it in the loop. After `progressPhase.value = ...` add:

```ts
        currentPhaseIndex.value = i
```

And in `finally`, reset it:

```ts
        currentPhaseIndex.value = -1
```

- [ ] **Step 2: Add `currentPhaseIndex` to the return value**

Update the return statement:

```ts
  return { isRunning, progressPercent, progressPhase, liveValue, canvasRef, currentPhaseIndex, run }
```

- [ ] **Step 3: Verify it compiles**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/composables/useGpuBenchmark.ts
git commit -m "feat: add 4-phase orchestrator to GPU benchmark composable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Update GPU Benchmark UI

**Files:**
- Modify: `src/renderer/views/GpuBenchmark.vue`

- [ ] **Step 1: Update GpuBenchmark.vue with phase indicator, per-phase metrics, and live canvas**

Replace the entire file content:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore } from '../stores/benchmark'
import { useGpuBenchmark } from '../composables/useGpuBenchmark'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()
const { isRunning, progressPercent, progressPhase, liveValue, canvasRef, currentPhaseIndex, run } = useGpuBenchmark()

const result = computed(() => benchmark.resultMap['gpu'])

const phaseNames = ['Fillrate', 'Geometry', 'Compute', 'Bandwidth']
const phaseIcons = ['🔴', '🟡', '🟢', '🔵']
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">🎮 {{ $t('nav.gpu') }}</h2>
        <p class="page-subtitle">4-phase GPU pressure test — fillrate, geometry, compute, bandwidth</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="run()">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <!-- LIVE CANVAS PREVIEW -->
    <div v-if="isRunning" class="bench-card mb-6">
      <!-- Phase dots indicator -->
      <div class="flex items-center justify-center gap-3 mb-3">
        <div
          v-for="(name, idx) in phaseNames"
          :key="name"
          class="flex items-center gap-1.5"
        >
          <div
            class="w-3 h-3 rounded-full transition-all duration-300"
            :class="{
              'bg-blue-500 scale-125 shadow-lg shadow-blue-500/50': idx === currentPhaseIndex,
              'bg-green-500': idx < (currentPhaseIndex >= 0 ? currentPhaseIndex : 999),
              'bg-gray-600': idx !== currentPhaseIndex && !(idx < (currentPhaseIndex >= 0 ? currentPhaseIndex : 999)),
            }"
          />
          <span
            class="text-xs"
            :class="idx === currentPhaseIndex ? 'text-blue-400 font-semibold' : 'text-gray-500'"
          >{{ name }}</span>
        </div>
      </div>

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

    <!-- RESULTS -->
    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />

      <!-- Per-phase metrics -->
      <div class="grid grid-cols-2 gap-3 mt-4">
        <div v-if="result.metrics.fillrateMPix" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔴 Fillrate</div>
          <div class="text-xl font-bold text-red-400">{{ (result.metrics.fillrateMPix / 1000).toFixed(1) }}G</div>
          <div class="text-xs text-gray-500">Pix/s</div>
        </div>
        <div v-if="result.metrics.geometryMTri" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟡 Geometry</div>
          <div class="text-xl font-bold text-yellow-400">{{ result.metrics.geometryMTri.toLocaleString() }}</div>
          <div class="text-xs text-gray-500">MTri/s</div>
        </div>
        <div v-if="result.metrics.computeMPix" class="bench-card text-center">
          <div class="text-sm text-gray-400">🟢 Compute</div>
          <div class="text-xl font-bold text-green-400">{{ (result.metrics.computeMPix / 1000).toFixed(1) }}G</div>
          <div class="text-xs text-gray-500">Pix/s</div>
        </div>
        <div v-if="result.metrics.bandwidthGBps" class="bench-card text-center">
          <div class="text-sm text-gray-400">🔵 Bandwidth</div>
          <div class="text-xl font-bold text-blue-400">{{ result.metrics.bandwidthGBps }}</div>
          <div class="text-xs text-gray-500">GB/s</div>
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/r/pc-benchmark
git add src/renderer/views/GpuBenchmark.vue
git commit -m "feat: update GPU benchmark UI with phase dots and per-phase metrics

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Integration Verification

**Files:**
- Verify: `src/renderer/composables/useGpuBenchmark.ts`
- Verify: `src/renderer/views/GpuBenchmark.vue`
- Verify: `src/renderer/utils/scoring.ts`

- [ ] **Step 1: Run the full test suite**

```bash
cd C:/Users/r/pc-benchmark && npx vitest run
```

Expected: All existing tests pass, GPU scoring tests pass.

- [ ] **Step 2: Run type checking**

```bash
cd C:/Users/r/pc-benchmark && npx vue-tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Verify build succeeds**

```bash
cd C:/Users/r/pc-benchmark && npm run build
```

Expected: Build succeeds, output in `out/` directory.

- [ ] **Step 4: Launch dev mode for visual verification**

```bash
cd C:/Users/r/pc-benchmark && npm run dev
```

Manual checklist:
- [ ] App launches without errors
- [ ] GPU test page shows 4 phase dots during test
- [ ] Live canvas updates during each phase
- [ ] Per-phase metrics display after test completes
- [ ] Overall GPU score shows
- [ ] Running "All benchmarks" works (if applicable)

- [ ] **Step 5: Commit any fixes, push**

```bash
cd C:/Users/r/pc-benchmark
git add -A
git commit -m "chore: integration fixes after manual verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git push origin master
```

---

## Summary

| Task | Files | What |
|---|---|---|
| 1 | `scoring.ts`, test | 4-metric scoring + backward compat |
| 2 | `useGpuBenchmark.ts` | Phase 1 fillrate + generic `runPhase` |
| 3 | `useGpuBenchmark.ts` | Phase 2 geometry (500K triangles) |
| 4 | `useGpuBenchmark.ts` | Phase 3 compute (upgraded shader) |
| 5 | `useGpuBenchmark.ts` | Phase 4 bandwidth (MRT + textures) |
| 6 | `useGpuBenchmark.ts` | Orchestrator loop |
| 7 | `GpuBenchmark.vue` | Phase dots + per-phase metrics UI |
| 8 | all | Type check, build, visual verification |
