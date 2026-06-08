import { parentPort } from 'worker_threads'
import fs from 'fs'
import path from 'path'
import os from 'os'

function postProgress(phase: string, progress: number, metrics?: Record<string, number>) {
  parentPort?.postMessage({ type: 'disk', phase, progress, metrics })
}

const TEST_FILE = path.join(os.tmpdir(), 'pc-benchmark-disk-test.bin')
const SEQ_SIZE = 256 * 1024 * 1024 // 256MB sequential
const BLOCK_4K = 4096
const RANDOM_IO_COUNT = 50000 // 50K IOs to defeat OS cache
const RANDOM_SIZE = 1900 * 1024 * 1024 // ~1.9GB (just under Node.js Buffer limit of 2GB)

async function run(): Promise<void> {
  const startTime = performance.now()

  try {
    postProgress('Sequential write (256MB)', 5)
    const writeBuf = Buffer.alloc(SEQ_SIZE, 0xAB)
    const t1 = performance.now()
    fs.writeFileSync(TEST_FILE, writeBuf)
    const seqWriteMBps = SEQ_SIZE / ((performance.now() - t1) / 1000) / (1024 * 1024)
    postProgress('Sequential write', 30, { seqWriteMBps: Math.round(seqWriteMBps) })

    postProgress('Sequential read (256MB)', 35)
    const t2 = performance.now()
    fs.readFileSync(TEST_FILE)
    const seqReadMBps = SEQ_SIZE / ((performance.now() - t2) / 1000) / (1024 * 1024)
    postProgress('Sequential read', 60, {
      seqWriteMBps: Math.round(seqWriteMBps),
      seqReadMBps: Math.round(seqReadMBps),
    })

    postProgress('Random 4K write', 65)
    const randomBuf = Buffer.alloc(RANDOM_SIZE, 0xCD)
    fs.writeFileSync(TEST_FILE, randomBuf)
    const fd = fs.openSync(TEST_FILE, 'r+')
    // Flush OS buffers to ensure test hits actual disk
    try { fs.fdatasyncSync(fd) } catch { /* not available on all platforms */ }
    const block4k = Buffer.alloc(BLOCK_4K, 0xEF)
    const positions: number[] = []
    const maxBlock = Math.floor(RANDOM_SIZE / BLOCK_4K)
    // Use deterministic seed to span the full 2GB range
    let seed = 12345
    for (let i = 0; i < RANDOM_IO_COUNT; i++) {
      seed = (seed * 1103515245 + 12345) | 0
      positions.push(((seed >>> 0) % maxBlock) * BLOCK_4K)
    }
    const t3 = performance.now()
    for (let i = 0; i < RANDOM_IO_COUNT; i++) {
      fs.writeSync(fd, block4k, 0, BLOCK_4K, positions[i])
    }
    const randWriteIOPS = Math.round(RANDOM_IO_COUNT / ((performance.now() - t3) / 1000))
    postProgress('Random 4K write', 82, {
      seqWriteMBps: Math.round(seqWriteMBps),
      seqReadMBps: Math.round(seqReadMBps),
      randomWriteIOPS: randWriteIOPS,
    })

    postProgress('Random 4K read', 85)
    const readBlock = Buffer.alloc(BLOCK_4K)
    const t4 = performance.now()
    for (let i = 0; i < RANDOM_IO_COUNT; i++) {
      fs.readSync(fd, readBlock, 0, BLOCK_4K, positions[i])
    }
    const randReadIOPS = Math.round(RANDOM_IO_COUNT / ((performance.now() - t4) / 1000))
    fs.closeSync(fd)

    postProgress('Random 4K read', 100, {
      seqWriteMBps: Math.round(seqWriteMBps),
      seqReadMBps: Math.round(seqReadMBps),
      randomWriteIOPS: randWriteIOPS,
      randomReadIOPS: randReadIOPS,
    })

    parentPort?.postMessage({
      type: 'disk', phase: 'complete', progress: 100, done: true,
      metrics: {
        seqWriteMBps: Math.round(seqWriteMBps),
        seqReadMBps: Math.round(seqReadMBps),
        randomWriteIOPS: randWriteIOPS,
        randomReadIOPS: randReadIOPS,
        duration: Math.round(performance.now() - startTime),
      },
    })
  } finally {
    try { fs.unlinkSync(TEST_FILE) } catch { /* ignore */ }
  }
  process.exit(0)
}

run().catch((err) => {
  try { fs.unlinkSync(TEST_FILE) } catch { /* ignore */ }
  parentPort?.postMessage({ error: err.message })
  process.exit(1)
})
