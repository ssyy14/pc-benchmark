import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { Worker } from 'worker_threads'
import type { SystemInfo, BenchmarkResult, BenchmarkProgress } from './bridge'
import os from 'os'
import Store from 'electron-store'

const store = new Store<{ results: BenchmarkResult[] }>({
  defaults: { results: [] }
})

function createWorker(workerScript: string): Worker {
  return new Worker(join(__dirname, './workers', workerScript))
}

function getSystemInfo(): SystemInfo {
  const cpus = os.cpus()
  return {
    cpuModel: cpus[0]?.model || 'Unknown',
    cpuCores: os.cpus().length,
    cpuThreads: os.cpus().length,
    totalMemoryGB: Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10,
    osName:
      process.platform === 'win32'
        ? 'Windows'
        : process.platform === 'darwin'
          ? 'macOS'
          : 'Linux',
    osVersion: os.release(),
    gpuModel: 'Detecting...',
    gpuVendor: '',
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
