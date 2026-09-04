/**
 * 两只手到底起什么作用。
 *
 * 这一层原先几乎什么都没做：两只手都拍了，第二只只被压成一个综合分，
 * 换出一句「右优于左」。而且「惯用手」是从**拍摄顺序**推的 ——
 * 调用方传的就是第一张照片那只手，于是左撇子被当成右利手处理，毫无提示。
 *
 * 所以这里钉三件事：
 *   1. 惯用手由用户回答决定，断语出自惯用手那只（左撇子必须走对）
 *   2. 先天／后天是逐线的**差**，不是谁优谁劣
 *   3. 条件不足（只拍一只手、没答惯用手）时如实为 null，不猜
 */

import { describe, expect, it } from 'vitest'
import type { PalmLineName } from '@/core/types'
import { applyHandRules, type HandRuleInput } from '../rules'
import { pickPrimaryIndex } from '../pipeline'
import type { LineMeasure } from '../palmlines'
import { T } from '../thresholds'

const M: HandRuleInput['m'] = {
  palmLen: 0.42,
  palmWidth: 0.36,
  palmAspect: 0.857,
  fingerLen: { thumb: 0.2, index: 0.3, middle: 0.33, ring: 0.31, pinky: 0.24 },
  fingerPalmRatio: 0.79,
  thumbRatio: 0.48,
  indexRingRatio: 0.97,
  pinkyLong: false,
  knuckleProminence: 0.4,
}

const MOUNTS_IN = Object.fromEntries(
  ['木星丘', '土星丘', '太阳丘', '水星丘', '金星丘', '月丘', '火星丘'].map((k) => [
    k,
    { fullness: 0.5, band: 'balanced' as const },
  ]),
) as HandRuleInput['mounts']

function measure(over: Partial<LineMeasure> = {}): LineMeasure {
  return {
    name: '生命线',
    matchScore: 0.8,
    lengthRatio: 1,
    depth: 0.6,
    continuity: 0.9,
    curvature: 0.1,
    signedCurvature: -0.1,
    branches: 0,
    doubled: false,
    endRising: false,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    corrected: false,
    ...over,
  }
}

const linesOf = (spec: Partial<Record<PalmLineName, Partial<LineMeasure>>>) =>
  new Map<PalmLineName, LineMeasure>(
    Object.entries(spec).map(([n, o]) => [n as PalmLineName, measure({ name: n as PalmLineName, ...o })]),
  )

const run = (over: Partial<HandRuleInput> = {}) =>
  applyHandRules({
    m: M,
    lines: linesOf({ 生命线: {}, 智慧线: {}, 感情线: {} }),
    mounts: MOUNTS_IN,
    qualityFactor: 0.9,
    detectorScore: 0.95,
    handedness: 'Right',
    dominantHand: 'right',
    handsCaptured: ['left', 'right'],
    ...over,
  })

/* ============================================================
   一、断语出自惯用手 —— 左撇子必须走对
   ============================================================ */

describe('惯用手决定断语出自哪只手', () => {
  const analyses = [{ side: 'right' as const }, { side: 'left' as const }]

  it('右利手：取右手那一张', () => {
    expect(pickPrimaryIndex(analyses, 'right')).toBe(0)
  })

  it('左撇子：取左手那一张 —— 哪怕它是第二张拍的', () => {
    // 这条就是那个静默 bug 的回归测试：原实现永远返回 0
    expect(pickPrimaryIndex(analyses, 'left')).toBe(1)
  })

  it('拍摄顺序颠倒也照惯用手取，不照顺序', () => {
    const reversed = [{ side: 'left' as const }, { side: 'right' as const }]
    expect(pickPrimaryIndex(reversed, 'right')).toBe(1)
    expect(pickPrimaryIndex(reversed, 'left')).toBe(0)
  })

  it('没答惯用手：退回第一张（此时不会做先天后天分派）', () => {
    expect(pickPrimaryIndex(analyses, null)).toBe(0)
  })

  it('答了惯用手但那只没拍到：退回第一张', () => {
    expect(pickPrimaryIndex([{ side: 'right' as const }], 'left')).toBe(0)
  })
})

/* ============================================================
   二、先天／后天是差，不是优劣
   ============================================================ */

describe('先天／后天对照', () => {
  it('右利手：右手论后天，左手论先天', () => {
    const c = run({ dominantHand: 'right', otherHandLines: linesOf({ 生命线: {} }) }).derived
      .handContrast!
    expect(c.dominant).toBe('right')
    expect(c.innateSide).toBe('left')
  })

  it('左撇子：左手论后天，右手论先天 —— 整条链都跟着转', () => {
    const c = run({
      dominantHand: 'left',
      handedness: 'Left',
      otherHandLines: linesOf({ 生命线: {} }),
    }).derived.handContrast!
    expect(c.dominant).toBe('left')
    expect(c.innateSide).toBe('right')
  })

  it('差值一律「后天 − 先天」，正负号可读', () => {
    const c = run({
      lines: linesOf({ 生命线: { lengthRatio: 1.3, depth: 0.7, continuity: 0.95 } }),
      otherHandLines: linesOf({ 生命线: { lengthRatio: 1.0, depth: 0.5, continuity: 0.6 } }),
    }).derived.handContrast!
    const item = c.items.find((i) => i.line === '生命线')!
    expect(item.dLengthRatio).toBeCloseTo(0.3, 6)
    expect(item.dDepth).toBeCloseTo(0.2, 6)
    expect(item.dContinuity).toBeCloseTo(0.35, 6)
    expect(item.notable).toBe(true)
  })

  it('差异小于判线的记 notable=false —— 不拿它铺陈成一段', () => {
    const tiny = T.handDiff / 2
    const c = run({
      lines: linesOf({ 生命线: { lengthRatio: 1 + tiny, depth: 0.6, continuity: 0.9 } }),
      otherHandLines: linesOf({ 生命线: { lengthRatio: 1, depth: 0.6, continuity: 0.9 } }),
    }).derived.handContrast!
    expect(c.items[0].notable).toBe(false)
  })

  it('只有一只手测到的线不参与对照 —— 缺项不判', () => {
    const c = run({
      lines: linesOf({ 生命线: {}, 智慧线: {} }),
      otherHandLines: linesOf({ 生命线: {} }),
    }).derived.handContrast!
    expect(c.items.map((i) => i.line)).toEqual(['生命线'])
  })

  it('不再出「优于」那种措辞 —— 两手之间只谈差异', () => {
    const out = run({ otherHandLines: linesOf({ 生命线: {} }) })
    expect(out.derived.leftRightComparison).toBeUndefined()
    const text = JSON.stringify(out.derived)
    expect(text).not.toContain('优于')
  })
})

/* ============================================================
   三、条件不足就如实为 null
   ============================================================ */

describe('条件不足不猜', () => {
  it('只拍了一只手：对照为 null，且 unavailable 里记一条', () => {
    const out = run({ handsCaptured: ['right'], otherHandLines: null })
    expect(out.derived.handContrast).toBeNull()
    expect(out.unavailable.some((u) => u.label === '左右手对照')).toBe(true)
  })

  it('两只手都拍了但没答惯用手：仍为 null —— 分不清谁论后天就不分', () => {
    const out = run({ dominantHand: null, otherHandLines: linesOf({ 生命线: {} }) })
    expect(out.derived.handContrast).toBeNull()
  })

  it('答的惯用手不在本次采集里：为 null', () => {
    const out = run({
      dominantHand: 'left',
      handsCaptured: ['right'],
      otherHandLines: linesOf({ 生命线: {} }),
    })
    expect(out.derived.handContrast).toBeNull()
  })

  it('两手都测到的线为零条：为 null，不给一张空表', () => {
    const out = run({
      lines: linesOf({ 生命线: {} }),
      otherHandLines: linesOf({ 太阳线: {} }),
    })
    expect(out.derived.handContrast).toBeNull()
  })
})
