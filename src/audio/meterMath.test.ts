import { describe, expect, it } from 'vitest'
import {
  MIN_DB,
  classifyLevel,
  dbToPower,
  equivalentLevel,
  meanSquare,
  powerToDb,
  smoothingCoefficient,
} from './meterMath'

describe('powerToDb / dbToPower', () => {
  it('round-trips', () => {
    expect(powerToDb(dbToPower(-37.5))).toBeCloseTo(-37.5, 6)
  })

  it('reports silence as the floor', () => {
    expect(powerToDb(0)).toBe(MIN_DB)
    expect(powerToDb(1e-20)).toBe(MIN_DB)
  })

  it('puts a full-scale sine at -3 dBFS', () => {
    const n = 4800
    const sine = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000))
    expect(powerToDb(meanSquare(sine))).toBeCloseTo(-3.01, 1)
  })
})

describe('smoothingCoefficient', () => {
  it('does nothing without elapsed time', () => {
    expect(smoothingCoefficient(0, 125)).toBe(0)
  })

  it('is frame-rate independent: two half steps equal one full step', () => {
    const full = smoothingCoefficient(32, 125)
    const half = smoothingCoefficient(16, 125)
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(full, 10)
  })

  it('reaches ~63% after one time constant', () => {
    expect(smoothingCoefficient(125, 125)).toBeCloseTo(0.632, 3)
  })
})

describe('classifyLevel', () => {
  it('uses the thresholds as inclusive lower bounds', () => {
    expect(classifyLevel(59.9, 60, 70)).toBe('calm')
    expect(classifyLevel(60, 60, 70)).toBe('caution')
    expect(classifyLevel(69.9, 60, 70)).toBe('caution')
    expect(classifyLevel(70, 60, 70)).toBe('alarm')
  })
})

describe('equivalentLevel', () => {
  it('is empty-safe', () => {
    expect(equivalentLevel([])).toBe(MIN_DB)
  })

  it('keeps a constant level constant', () => {
    expect(equivalentLevel([60, 60, 60])).toBeCloseTo(60, 6)
  })

  it('is dominated by the loud part (energy average, not arithmetic)', () => {
    expect(equivalentLevel([70, 60])).toBeCloseTo(67.4, 1)
  })
})
