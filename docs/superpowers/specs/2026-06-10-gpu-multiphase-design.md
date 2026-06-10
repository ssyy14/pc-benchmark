# GPU Benchmark — Multi-Phase Pressure Test

**Date**: 2026-06-10  
**Status**: Design approved

## Motivation

Current GPU benchmark runs a single 4K procedural shader burn-in for 6 seconds. Only one metric (MPix/s throughput) is captured. The score formula weights `gpuBandwidthGBps` at 30% but it is always 0 — bandwidth is never measured. A single shader type cannot distinguish GPU subsystems (fillrate, geometry, compute, bandwidth).

## Design: 4-Phase GPU Pressure Test

Replace the single-shader test with 4 sequential phases, each stressing a different GPU subsystem. Total duration ~25 seconds.

### Phase 1: Fillrate — 5 seconds

**What it stresses**: ROP throughput, pixel blending, framebuffer bandwidth  
**Shader**: Minimal fragment shader (output constant color, no math)  
**Technique**: Hundreds of full-screen quads stacked with alpha blending enabled, forcing massive overdraw — each pixel written tens to hundreds of times per frame  
**Canvas resolution**: 4K (3840×2160)  
**Metric**: GPix/s — billions of pixels processed per second  
**Reference baseline**: 80 GPix/s ≈ RTX 3060

### Phase 2: Geometry — 6 seconds

**What it stresses**: Vertex shader throughput, primitive assembly, rasterization setup  
**Shader**: Vertex shader performs full MVP matrix transform; fragment shader is minimal (bottleneck on geometry pipeline)  
**Technique**: Generate 500K+ micro-triangles (2-3 pixels each), randomly distributed  
**Canvas resolution**: 1920×1080  
**Metric**: MTri/s — millions of triangles processed per second  
**Reference baseline**: 10,000 MTri/s ≈ RTX 3060

### Phase 3: Compute — 8 seconds

**What it stresses**: ALU throughput, FP32 math, branching  
**Shader**: Upgraded version of the current procedural shader — more FBM octaves, volumetric accumulation, ray-marching steps, branch-heavy  
**Canvas resolution**: 4K (3840×2160)  
**Metric**: GPix/s throughput  
**Reference baseline**: 100 GPix/s ≈ RTX 3060

### Phase 4: Bandwidth — 6 seconds

**What it stresses**: Texture sampling bandwidth, memory bus, texture cache  
**Shader**: Heavy multi-texture sampling — 4 large textures (4096² each), multiple samples per pixel  
**Technique**: Uses Multi Render Target (MRT) to write 4 color buffers simultaneously, maximizing memory bandwidth utilization  
**Canvas resolution**: 2560×1440  
**Metric**: GB/s effective bandwidth  
**Reference baseline**: 80 GB/s ≈ RTX 3060

## Scoring

Each phase produces a normalized sub-score (0-10000). Final GPU score is weighted:

| Phase | Reference Value | Weight |
|---|---|---|
| Fillrate | 80,000 MPix/s | 25% |
| Geometry | 10,000 MTri/s | 25% |
| Compute | 100,000 MPix/s | 30% |
| Bandwidth | 80 GB/s | 20% |

`gpuBandwidthGBps` metric will no longer be 0 — it comes from Phase 4.

## UI Changes

- **During test**: Show current phase name + live canvas render + phase dots indicator (4 dots, filled = completed)
- **Progress bar**: Maps 0-100% across all 4 phases (25% per phase)
- **Results card**: Show 4 individual phase metrics + total GPU score
- **Radar chart**: GPU dimension now reflects comprehensive capability

## Code Changes

### Files to modify
- `src/renderer/composables/useGpuBenchmark.ts` — rewrite with 4-phase logic
- `src/renderer/views/GpuBenchmark.vue` — add phase indicator UI
- `src/renderer/utils/scoring.ts` — update `calculateGpuScore` to use 4 metrics

### Files unchanged
- `electron/main.ts` — no changes (GPU detection is fine)
- `electron/bridge.ts` — no changes
- `src/renderer/stores/benchmark.ts` — no changes
- `useGraphicsBenchmark.ts` — separate concern, unchanged

## Edge Cases

- **WebGL2 unavailable**: Catch and show error, skip GPU test entirely
- **Phase failure**: If any phase throws, mark entire GPU test as skipped with error message
- **Low-end GPUs**: Each phase runs at its own resolution; 4K may be too heavy for integrated graphics — the scoring formula handles this naturally (lower throughput → lower score)
- **Thermal throttling**: 25-second test is long enough to capture throttling effects; scores will reflect sustained performance
- **High refresh displays**: Use `requestAnimationFrame` — vsync may cap apparent throughput. Use `desynchronized: true` on canvas context where available

## Non-Goals

- Adaptive parameter tuning (future — Scheme C)
- VRAM size detection
- GPU temperature monitoring
- WebGPU / compute shader integration (requires WebGPU support)
