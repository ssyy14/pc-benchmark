export interface TierInfo {
  tier: number
  label: string
  emoji: string
  color: string
}

const REFERENCES: Record<string, Record<string, number>> = {
  cpu: {
    singleCoreMOps: 5000,
    multiCoreMOps: 20000,
    cryptoMBps: 2000,
  },
  memory: {
    readBandwidthGBps: 30,
    writeBandwidthGBps: 20,
    latencyNs: 80,
  },
  disk: {
    seqReadMBps: 2000,
    seqWriteMBps: 1000,
    randomReadIOPS: 50000,
    randomWriteIOPS: 30000,
  },
  gpu: {
    computeGFLOPS: 2000,
    memoryBandwidthGBps: 200,
  },
  graphics: {
    fps1080p: 60,
    fps720p: 90,
    fps480p: 120,
  },
}

export function normalizeScore(raw: number, reference: number, lowerIsBetter = false): number {
  if (reference === 0) return 0
  let score = lowerIsBetter ? (reference / Math.max(raw, 0.001)) * 5000 : (raw / reference) * 5000
  return Math.round(Math.min(10000, Math.max(0, score)))
}

export function calculateCpuScore(metrics: Record<string, number>): number {
  const ref = REFERENCES.cpu
  const single = normalizeScore(metrics.singleCoreMOps || 0, ref.singleCoreMOps)
  const multi = normalizeScore(metrics.multiCoreMOps || 0, ref.multiCoreMOps)
  const crypto = normalizeScore(metrics.cryptoMBps || 0, ref.cryptoMBps)
  return Math.round(single * 0.25 + multi * 0.55 + crypto * 0.2)
}

export function calculateMemoryScore(metrics: Record<string, number>): number {
  const ref = REFERENCES.memory
  const read = normalizeScore(metrics.readBandwidthMBps || 0, ref.readBandwidthGBps * 1024)
  const write = normalizeScore(metrics.writeBandwidthMBps || 0, ref.writeBandwidthGBps * 1024)
  const latency = normalizeScore(metrics.latencyNs || 100, ref.latencyNs, true)
  return Math.round(read * 0.35 + write * 0.25 + latency * 0.4)
}

export function calculateDiskScore(metrics: Record<string, number>): number {
  const ref = REFERENCES.disk
  const seqRead = normalizeScore(metrics.seqReadMBps || 0, ref.seqReadMBps)
  const seqWrite = normalizeScore(metrics.seqWriteMBps || 0, ref.seqWriteMBps)
  const randRead = normalizeScore(metrics.randomReadIOPS || 0, ref.randomReadIOPS)
  const randWrite = normalizeScore(metrics.randomWriteIOPS || 0, ref.randomWriteIOPS)
  return Math.round(seqRead * 0.25 + seqWrite * 0.2 + randRead * 0.3 + randWrite * 0.25)
}

export function calculateGpuScore(metrics: Record<string, number>): number {
  // Real GPU WebGL path (fps-based)
  if (metrics.fps1080p) {
    const fps1080 = normalizeScore(metrics.fps1080p, 120)
    const fps720 = normalizeScore(metrics.fps720p || 0, 180)
    const bw = normalizeScore(metrics.gpuBandwidthGBps || 0, 100)
    return Math.round(fps1080 * 0.55 + fps720 * 0.15 + bw * 0.30)
  }
  // Fallback: CPU compute path
  const ref = REFERENCES.gpu
  const compute = normalizeScore(metrics.computeGFLOPS || 0, ref.computeGFLOPS)
  const bandwidth = normalizeScore(metrics.memoryBandwidthGBps || 0, ref.memoryBandwidthGBps)
  return Math.round(compute * 0.6 + bandwidth * 0.4)
}

export function calculateGraphicsScore(metrics: Record<string, number>): number {
  const ref = REFERENCES.graphics
  const fps1080 = normalizeScore(metrics.fps1080p || 0, ref.fps1080p)
  const fps720 = normalizeScore(metrics.fps720p || 0, ref.fps720p)
  const fps480 = normalizeScore(metrics.fps480p || 0, ref.fps480p)
  return Math.round(fps1080 * 0.5 + fps720 * 0.3 + fps480 * 0.2)
}

export function calculateOverallScore(scores: Record<string, number>): number {
  const weights: Record<string, number> = {
    cpu: 0.3, memory: 0.15, disk: 0.15, gpu: 0.25, graphics: 0.15,
  }
  let total = 0, weightSum = 0
  for (const [type, score] of Object.entries(scores)) {
    if (score >= 0) {
      total += score * (weights[type] || 0)
      weightSum += weights[type] || 0
    }
  }
  return weightSum > 0 ? Math.round(total / weightSum) : 0
}

export function getTier(score: number): TierInfo {
  if (score >= 8500) return { tier: 5, label: '发烧级', emoji: '👑', color: '#dc2626' }
  if (score >= 6500) return { tier: 4, label: '旗舰', emoji: '💎', color: '#7c3aed' }
  if (score >= 4000) return { tier: 3, label: '高性能', emoji: '🥇', color: '#2563eb' }
  if (score >= 2000) return { tier: 2, label: '主流', emoji: '🥈', color: '#16a34a' }
  return { tier: 1, label: '入门', emoji: '🥉', color: '#6b7280' }
}
