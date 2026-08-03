/**
 * 分档与判线余量。
 *
 * 余量这层的意义：阈值本身是工程判断（thresholds.ts 里一堆 CALIBRATE），
 * 所以「正压在判线上」和「稳稳落在档中央」不该给同样的口气。
 */

import { describe, expect, it } from 'vitest'
import {
  applyMargin,
  bandMargin,
  BORDERLINE_MARGIN,
  grade,
  toBand,
  type BandSpec,
  type DraftFeature,
} from '../band'

// 中和区 [0.9, 1.1]，半宽 0.1
const SPEC: BandSpec = { veryLo: 0.7, lo: 0.9, hi: 1.1, veryHi: 1.3 }

describe('分档', () => {
  it.each([
    [0.6, 'very_low'],
    [0.7, 'very_low'],
    [0.8, 'low'],
    [1.0, 'balanced'],
    [1.2, 'high'],
    [1.3, 'very_high'],
    [1.5, 'very_high'],
  ] as const)('%s → %s', (v, band) => {
    expect(toBand(v, SPEC)).toBe(band)
  })
})

describe('判线余量', () => {
  it('正压在判线上时为 0', () => {
    for (const edge of [SPEC.veryLo, SPEC.lo, SPEC.hi, SPEC.veryHi]) {
      expect(bandMargin(edge, SPEC)).toBe(0)
    }
  })

  it('档中央时最大', () => {
    expect(bandMargin(1.0, SPEC)).toBeCloseTo(1, 10) // 距 lo/hi 各 0.1，等于半宽
  })

  it('以中和区半宽为单位 —— 不同量纲的指标可以横向比', () => {
    // 半宽 0.1，离判线 0.05 → 0.5
    expect(bandMargin(0.95, SPEC)).toBeCloseTo(0.5, 5)
    const wide: BandSpec = { veryLo: 7, lo: 9, hi: 11, veryHi: 13 }
    expect(bandMargin(9.5, wide)).toBeCloseTo(0.5, 5)
  })

  it('退化区间不会除零', () => {
    expect(bandMargin(1, { veryLo: 1, lo: 1, hi: 1, veryHi: 1 })).toBe(1)
  })
})

describe('grade', () => {
  it('贴线判定与置信度乘数', () => {
    const onLine = grade(SPEC.lo, SPEC)
    expect(onLine.borderline).toBe(true)
    expect(onLine.confFactor).toBeCloseTo(0.7, 5)

    const safe = grade(1.0, SPEC)
    expect(safe.borderline).toBe(false)
    expect(safe.confFactor).toBe(1)
  })

  it('乘数在贴线区内连续，不跳变', () => {
    const justInside = grade(SPEC.lo + 0.1 * BORDERLINE_MARGIN * 0.999, SPEC)
    expect(justInside.confFactor).toBeGreaterThan(0.7)
    expect(justInside.confFactor).toBeLessThan(1)
  })
})

describe('applyMargin', () => {
  const draft = (value: number | string, confidence = 0.9): DraftFeature => ({
    id: 'face.test',
    category: '五眼',
    label: '测试项',
    band: 'balanced',
    value,
    status: 'measured',
    confidence,
    evidence: '实测值 X',
    meaning: '测试用',
    source: null,
  })

  it('贴线项：压低置信度并在证据里说明', () => {
    const out = applyMargin(draft(SPEC.lo), SPEC)
    expect(out.confidence).toBeCloseTo(0.63, 2)
    expect(out.evidence).toContain('贴近分档判线')
  })

  it('档中央的项原样通过', () => {
    const d = draft(1.0)
    expect(applyMargin(d, SPEC)).toBe(d)
  })

  it('没给区间、或值不是数字的分类项，原样通过', () => {
    const d1 = draft(SPEC.lo)
    expect(applyMargin(d1, undefined)).toBe(d1)
    const d2 = draft('三停平均')
    expect(applyMargin(d2, SPEC)).toBe(d2)
  })

  it('不会把置信度压到可用门槛以下之外的地方 —— 只打七折', () => {
    const out = applyMargin(draft(SPEC.hi, 0.5), SPEC)
    expect(out.confidence).toBeCloseTo(0.35, 2)
  })
})
