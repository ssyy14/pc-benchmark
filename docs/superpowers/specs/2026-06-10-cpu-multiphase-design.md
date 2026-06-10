# CPU Benchmark — 4-Phase Multi-Core Pressure Test

**Date**: 2026-06-10
**Status**: Design approved

## Motivation

Current CPU benchmark has 3 phases (single-core 8s, multi-core 8s, crypto 5s) with moderate per-worker load. The multi-core phase already spawns one worker per logical core, but each worker's operations are lightweight — one cycle of sieve + mandelbrot + matrix multiply + SHA counts as 1 op. The single-core phase is redundant with the multi-core phase (the same operations). Scoring weights single-core at only 25%.

## Design: 4-Phase All-Core CPU Pressure Test

Replace the 3-phase test with 4 all-core phases, each targeting a different CPU subsystem. All phases use `os.cpus().length` workers concurrently. Total duration ~25 seconds.

### Phase 1: Integer — 6 seconds

**What it stresses**: ALU throughput, branch prediction, bit manipulation
**Per-worker operations**:
- Prime sieve with 50M range (was 2.5M — 20x larger)
- Bit rotation / popcount simulation (integer bit twiddling loop)
- Division/modulo storm on random large integers
**Metric**: Int MOps/s — integer millions of operations per second

### Phase 2: Floating Point — 7 seconds

**What it stresses**: FP64 ALU, SIMD paths, math library
**Per-worker operations**:
- 200×200 double-precision matrix multiply (was 80×80)
- In-place FFT on 16384-element complex array
- Trigonometric storm: sin/cos/exp/sqrt in tight loop
**Metric**: FP MOps/s — floating-point millions of operations per second

### Phase 3: Crypto — 6 seconds

**What it stresses**: AES-NI hardware acceleration, SHA pipeline, key derivation
**Per-worker operations**:
- AES-256-GCM encrypt/decrypt cycles
- SHA-512 hashing (upgraded from SHA-256)
- PBKDF2 key derivation with 10K iterations
**Metric**: Crypto MB/s — combined cryptographic throughput

### Phase 4: Mixed — 6 seconds

**What it stresses**: Realistic mixed workload, cache pressure, context switching
**Per-worker operations**:
- All of the above in one loop: sieve + FFT + matrix multiply + AES encrypt + SHA hash
- Zlib compression/decompression of random data
**Metric**: Mixed MOps/s — composite throughput

## Scoring

All phases are all-core. Single-core efficiency is derived from integer phase:
`singleCoreMOps = intMOps / coreCount`

Final CPU score weighted equally:

| Phase | Reference | Weight |
|---|---|---|
| Integer | 50,000 MOps/s (all-core) | 25% |
| Float | 30,000 MOps/s | 25% |
| Crypto | 5,000 MB/s | 25% |
| Mixed | 20,000 MOps/s | 25% |

## UI Changes

- **During test**: Phase dots indicator (like GPU), live metrics per phase
- **Results**: 4 per-phase metric cards + total score
- **Subtitle**: Updated to "4-phase all-core pressure test"

## Code Changes

### Files to modify
- `electron/workers/cpu-worker.ts` — rewrite with 4-phase all-core logic
- `src/renderer/views/CpuBenchmark.vue` — add phase dots, per-phase results
- `src/renderer/utils/scoring.ts` — update `calculateCpuScore` with new metric names

### Files unchanged
- `electron/main.ts` — no changes (worker management is fine)
- `src/renderer/stores/benchmark.ts` — no changes

## Edge Cases

- **Single-core CPU**: All phases still work (1 worker)
- **Worker crash**: Catch error, report 0 for that phase, continue
- **Large core counts (>32)**: Worker count = logical cores; may be very fast at integer ops
- **Low-end CPU**: Operations are designed to saturate; lower throughput → proportionally lower score

## Non-Goals

- CPU temperature monitoring
- Per-core utilization graphs
- AVX/SSE explicit detection
