# 🖥️ PC Benchmark

A cross-platform desktop application for benchmarking PC performance. Built with Electron + Vue 3.

![License](https://img.shields.io/github/license/ssyy14/pc-benchmark)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

## Features

- ⚡ **CPU Benchmark** — Single-core, multi-core, and crypto performance
- 🧠 **Memory Benchmark** — Read/write bandwidth and latency
- 💾 **Disk Benchmark** — Sequential and random 4K read/write
- 🎮 **GPU Benchmark** — Real-time 4K WebGL procedural shader burn-in
- 🏙️ **3D City Graphics Benchmark** — 200+ skyscrapers, PBR lighting, shadow mapping, dynamic sky
- 📊 **Scoring System** — 0-10000 score with 5-tier ratings
- 🌐 **Bilingual** — Chinese / English support
- 📈 **Radar Chart** — Visual performance overview

## What's New in v2.0

| Feature | v1.0 | v2.0 |
|---------|------|------|
| Graphics Test | 2D particle system | 3D city with 200+ skyscrapers |
| Lighting | Basic diffuse | PBR + real-time shadow mapping (4096×4096) |
| Sky | Solid color | Procedural blue sky with animated clouds |
| Sun | Static | Dynamic orbit with golden-hour color shift |
| Roads | None | Major avenues + side streets |
| Score Metric | Avg FPS | Peak GPU FPS (raw throughput) |
| Building Detail | Flat boxes | Multi-tier setbacks + spire crowns + windows |
| Package Size | Larger (dead code) | Cleaned up |

## Installation

Download the latest release from [Releases](https://github.com/ssyy14/pc-benchmark/releases).

- **Windows:** Run `PC-Benchmark-Setup.exe`
- **macOS:** Open `PC-Benchmark.dmg` and drag to Applications
- **Linux:** Run `PC-Benchmark.AppImage`

## Development

```bash
git clone https://github.com/ssyy14/pc-benchmark.git
cd pc-benchmark
npm install
npm run dev      # Development
npm run build    # Production build
npm test         # Run tests
```

## Tech Stack

Electron 30+, Vue 3, TypeScript, Vite, Naive UI, ECharts, Pinia, UnoCSS, WebGL2

## License

MIT
