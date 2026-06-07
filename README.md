# 🖥️ PC Benchmark

A cross-platform desktop application for benchmarking PC performance. Built with Electron + Vue 3.

![License](https://img.shields.io/github/license/ssyy14/pc-benchmark)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)

## Features

- ⚡ **CPU Benchmark** — Single-core, multi-core, and crypto performance
- 🧠 **Memory Benchmark** — Read/write bandwidth and latency
- 💾 **Disk Benchmark** — Sequential and random 4K read/write
- 🎮 **GPU Benchmark** — Compute throughput and memory bandwidth
- 🖼️ **Graphics Benchmark** — Rendering simulation at multiple resolutions
- 📊 **Scoring System** — 0-10000 score with 5-tier ratings
- 🌐 **Bilingual** — Chinese (中文) and English support
- 📈 **Radar Chart** — Visual performance overview

## Screenshots

*(Add screenshots here after running the app)*

## Installation

Download the latest release from [Releases](https://github.com/ssyy14/pc-benchmark/releases).

- **Windows:** Run `PC-Benchmark-Setup.exe`
- **macOS:** Open `PC-Benchmark.dmg` and drag to Applications
- **Linux:** Run `PC-Benchmark.AppImage`

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/ssyy14/pc-benchmark.git
cd pc-benchmark
npm install
```

### Run in Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

## Tech Stack

- **Desktop Shell:** Electron 30+
- **Frontend:** Vue 3 + Composition API + TypeScript
- **Build:** Vite + electron-vite
- **UI:** Naive UI + ECharts + UnoCSS
- **i18n:** vue-i18n (Chinese + English)
- **State:** Pinia

## License

MIT — see [LICENSE](LICENSE) file.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
