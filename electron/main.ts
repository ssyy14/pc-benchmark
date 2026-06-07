import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { Worker } from 'worker_threads'
import type { SystemInfo, BenchmarkResult, BenchmarkProgress } from './bridge'
import os from 'os'
import { execSync } from 'child_process'
import Store from 'electron-store'

const store = new Store<{ results: BenchmarkResult[] }>({
  defaults: { results: [] }
})

function createWorker(workerScript: string): Worker {
  return new Worker(join(__dirname, './workers', workerScript))
}

function detectGPU(): { model: string; vendor: string } {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }"',
        { timeout: 8000 }
      ).toString()
      const skipKeywords = ['Microsoft', 'Remote', 'Virtual', 'GameViewer', 'Mirror', 'Indirect']
      const names = out.trim().split('\n')
        .map(n => n.trim())
        .filter(n => n && !skipKeywords.some(k => n.includes(k)))
      // Prefer dedicated GPU: NVIDIA > AMD > Intel
      const nvidia = names.find(n => n.includes('NVIDIA'))
      const amd = names.find(n => n.includes('AMD') || n.includes('Radeon'))
      const intel = names.find(n => n.includes('Intel') || n.includes('Arc'))
      const name = nvidia || amd || intel || names[0]?.trim() || ''
      if (name) {
        const vendor = name.includes('NVIDIA') ? 'NVIDIA'
          : name.includes('AMD') || name.includes('Radeon') ? 'AMD'
          : name.includes('Intel') || name.includes('Arc') ? 'Intel'
          : ''
        return { model: name, vendor }
      }
    } else if (process.platform === 'darwin') {
      // macOS
      const out = execSync('system_profiler SPDisplaysDataType | grep "Chipset Model"', { timeout: 5000 }).toString()
      const name = out.split(':')[1]?.trim() || ''
      if (name) return { model: name, vendor: 'Apple' }
    } else {
      // Linux
      try {
        const out = execSync('lspci | grep -i vga', { timeout: 5000 }).toString()
        const name = out.split(':')[2]?.trim() || 'Unknown'
        if (name) return { model: name, vendor: '' }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { model: 'Unknown GPU', vendor: '' }
}

function getWindowsVersion(): { name: string; version: string } {
  try {
    const caption = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"',
      { timeout: 5000 }
    ).toString().trim()
    // caption looks like "Microsoft Windows 11 Home China"
    const name = caption.replace('Microsoft ', '')
    // Get build number for version string
    const build = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Version"',
      { timeout: 5000 }
    ).toString().trim()
    return { name, version: build }
  } catch {
    // Fallback: parse from os.release()
    const rel = os.release()
    const buildNum = rel.split('.').pop() || rel
    const isWin11 = parseInt(buildNum) >= 22000
    return { name: isWin11 ? 'Windows 11' : 'Windows 10', version: rel }
  }
}

function detectMacOSVersion(): { name: string; version: string } {
  try {
    const ver = execSync('sw_vers -productVersion', { timeout: 3000 }).toString().trim()
    const name = parseInt(ver) >= 15 ? 'macOS Sequoia'
      : parseInt(ver) >= 14 ? 'macOS Sonoma'
      : parseInt(ver) >= 13 ? 'macOS Ventura'
      : `macOS ${ver}`
    return { name, version: ver }
  } catch {
    return { name: 'macOS', version: os.release() }
  }
}

function detectLinuxDistro(): { name: string; version: string } {
  try {
    const out = execSync('cat /etc/os-release', { timeout: 3000 }).toString()
    const name = out.match(/^PRETTY_NAME="(.+)"$/m)?.[1] || 'Linux'
    return { name, version: os.release() }
  } catch {
    return { name: 'Linux', version: os.release() }
  }
}

function getSystemInfo(): SystemInfo {
  const cpus = os.cpus()
  const cpuModel = cpus[0]?.model?.trim() || 'Unknown'
  const totalThreads = cpus.length
  // Use Set to count unique cores (distinct by model+speed combo = physical)
  // Better approach: count distinct core IDs
  const coreIds = new Set(cpus.map(c => c.model + c.speed))
  const physicalCores = Math.max(1, coreIds.size)
  const gpu = detectGPU()

  let osInfo: { name: string; version: string }
  if (process.platform === 'win32') {
    osInfo = getWindowsVersion()
  } else if (process.platform === 'darwin') {
    osInfo = detectMacOSVersion()
  } else {
    osInfo = detectLinuxDistro()
  }

  return {
    cpuModel,
    cpuCores: physicalCores,
    cpuThreads: totalThreads,
    totalMemoryGB: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    osName: osInfo.name,
    osVersion: osInfo.version,
    gpuModel: gpu.model,
    gpuVendor: gpu.vendor,
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'PC Benchmark',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function runSingleBenchmark(
  type: string,
  mainWindow: BrowserWindow
): Promise<BenchmarkResult> {
  return new Promise((resolve, reject) => {
    const workerMap: Record<string, string> = {
      cpu: 'cpu-worker.js',
      memory: 'memory-worker.js',
      disk: 'disk-worker.js',
      gpu: 'gpu-worker.js',
      graphics: 'graphics-worker.js',
    }
    const script = workerMap[type]
    if (!script) {
      reject(new Error(`Unknown benchmark type: ${type}`))
      return
    }

    const worker = createWorker(script)
    let resolved = false

    worker.on('message', (msg: BenchmarkProgress & { done?: boolean; error?: string }) => {
      if (msg.error) {
        resolved = true
        reject(new Error(msg.error))
        return
      }
      if (msg.done) {
        resolved = true
        const result: BenchmarkResult = {
          type: msg.type,
          score: msg.metrics?.score || 0,
          metrics: msg.metrics || {},
          duration: msg.metrics?.duration || 0,
        }
        resolve(result)
      } else {
        mainWindow.webContents.send('benchmark:progress', msg)
      }
    })

    worker.on('error', (err) => {
      if (!resolved) {
        resolved = true
        reject(err)
      }
    })

    worker.on('exit', (code) => {
      if (!resolved) {
        resolved = true
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`))
        }
      }
    })
  })
}

// IPC handlers
ipcMain.handle('system:info', () => getSystemInfo())

ipcMain.handle('benchmark:run', async (event, type: string) => {
  const mainWindow = BrowserWindow.fromWebContents(event.sender)
  if (!mainWindow) throw new Error('No window')
  const result = await runSingleBenchmark(type, mainWindow)
  const results = store.get('results', []) as BenchmarkResult[]
  const idx = results.findIndex((r) => r.type === type)
  if (idx >= 0) results[idx] = result
  else results.push(result)
  store.set('results', results)
  return result
})

ipcMain.handle('benchmark:run-all', async (event) => {
  const mainWindow = BrowserWindow.fromWebContents(event.sender)
  if (!mainWindow) throw new Error('No window')
  const types = ['cpu', 'memory', 'disk', 'gpu', 'graphics']
  const results: BenchmarkResult[] = []
  for (const type of types) {
    try {
      const r = await runSingleBenchmark(type, mainWindow)
      results.push(r)
    } catch {
      results.push({ type, score: 0, metrics: {}, duration: 0, skipped: true })
    }
  }
  store.set('results', results)
  return results
})

ipcMain.handle('results:get', () => store.get('results', []))
ipcMain.handle('results:clear', () => {
  store.set('results', [])
  return true
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pc-benchmark')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
