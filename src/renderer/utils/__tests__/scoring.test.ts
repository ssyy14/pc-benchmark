import { describe, it, expect } from 'vitest'
import {
  normalizeScore,
  calculateCpuScore,
  calculateDiskScore,
  calculateOverallScore,
  getTier,
} from '../scoring'

describe('normalizeScore', () => {
  it('returns 5000 when raw equals reference', () => {
    expect(normalizeScore(5000, 5000)).toBe(5000)
  })

  it('returns 10000 when raw is double reference', () => {
    expect(normalizeScore(10000, 5000)).toBe(10000)
  })

  it('caps at 10000', () => {
    expect(normalizeScore(50000, 5000)).toBe(10000)
  })

  it('floors at 0', () => {
    expect(normalizeScore(-100, 5000)).toBe(0)
  })

  it('lowerIsBetter mode: fast latency scores high', () => {
    expect(normalizeScore(40, 80, true)).toBe(10000)
  })

  it('lowerIsBetter mode: slow latency scores low', () => {
    expect(normalizeScore(160, 80, true)).toBe(2500)
  })
})

describe('calculateCpuScore', () => {
  it('returns around 5000 for reference-level CPU', () => {
    const score = calculateCpuScore({
      singleCoreMOps: 5000,
      multiCoreMOps: 20000,
      cryptoMBps: 2000,
    })
    expect(score).toBeGreaterThan(4000)
    expect(score).toBeLessThan(6000)
  })
})

describe('calculateDiskScore', () => {
  it('returns around 5000 for reference-level disk', () => {
    const score = calculateDiskScore({
      seqReadMBps: 2000,
      seqWriteMBps: 1000,
      randomReadIOPS: 30000,
      randomWriteIOPS: 15000,
    })
    expect(score).toBeGreaterThan(4000)
    expect(score).toBeLessThan(6000)
  })
})

describe('calculateOverallScore', () => {
  it('computes weighted average', () => {
    const score = calculateOverallScore({
      cpu: 5000, memory: 5000, disk: 5000, gpu: 5000, graphics: 5000,
    })
    expect(score).toBe(5000)
  })
})

describe('getTier', () => {
  it('entry tier for low scores', () => {
    expect(getTier(500).tier).toBe(1)
  })

  it('mainstream tier for 2500', () => {
    expect(getTier(2500).tier).toBe(2)
  })

  it('high-perf tier for 5000', () => {
    expect(getTier(5000).tier).toBe(3)
  })

  it('flagship tier for 7000', () => {
    expect(getTier(7000).tier).toBe(4)
  })

  it('enthusiast tier for 9000', () => {
    expect(getTier(9000).tier).toBe(5)
  })
})
