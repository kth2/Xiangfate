/**
 * 掌图标号。
 *
 * 这一层不出判断，因此测的是排版契约：编号稳定、未测到也占号、
 * 徽标必须落在它所指的线上、掌丘只收偏离中和的、每个号都能在 features 里对上词。
 */

import { describe, expect, it } from 'vitest'
import type { MountBand, MountName, PalmLineName } from '@/core/types'
import { buildPalmMarks } from '../overlay'
import { CANVAS, MOUNTS } from '../landmarks'
import type { LineMeasure } from '../palmlines'
import { applyHandRules, type HandRuleInput } from '../rules'

/** 造一条从 (x0,y0) 到 (x1,y1) 的直线，点距均匀 */
function line(x0: number, y0: number, x1: number, y1: number, n = 21): LineMeasure {
  const points = Array.from({ length: n }, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / (n - 1),
    y: y0 + ((y1 - y0) * i) / (n - 1),
  }))
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
    points,
    corrected: false,
  }
}

const ALL_BALANCED = Object.fromEntries(
  (Object.keys(MOUNTS) as MountName[]).map((k) => [k, 'balanced' as MountBand]),
) as Record<MountName, MountBand>

const FOUR_LINES = new Map<PalmLineName, LineMeasure>([
  ['生命线', line(80, 100, 150, 460)],
  ['智慧线', line(70, 250, 430, 300)],
  ['感情线', line(460, 160, 120, 190)],
  ['命运线', line(260, 470, 250, 120)],
])

describe('掌图标号', () => {
  it('六条主线都占号，顺序固定 —— 未测到的也占，不悄悄跳过', () => {
    const marks = buildPalmMarks(new Map(), ALL_BALANCED)
    expect(marks.map((m) => m.name)).toEqual([
      '生命线',
      '智慧线',
      '感情线',
      '命运线',
      '太阳线',
      '婚姻线',
    ])
    expect(marks.map((m) => m.n)).toEqual([1, 2, 3, 4, 5, 6])
    // 一条都没测到时，图上不该落任何标号
    expect(marks.every((m) => m.anchor === null)).toBe(true)
  })

  it('测到的线：徽标必须落在这条线自己身上', () => {
    const marks = buildPalmMarks(FOUR_LINES, ALL_BALANCED)
    for (const m of marks) {
      if (!m.anchor || !m.path) continue
      const onPath = m.path.some(
        (p) => Math.abs(p.x - m.anchor!.x) < 1e-6 && Math.abs(p.y - m.anchor!.y) < 1e-6,
      )
      expect(onPath, `${m.name} 的徽标落到线外去了`).toBe(true)
    }
  })

  it('徽标之间尽量拉开 —— 四条主线互相不挤在一处', () => {
    const marks = buildPalmMarks(FOUR_LINES, ALL_BALANCED)
    const pts = marks.map((m) => m.anchor).filter((a): a is { x: number; y: number } => !!a)
    expect(pts.length).toBe(4)
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
        expect(d, `第 ${i} 与第 ${j} 个徽标只隔 ${d.toFixed(0)}px`).toBeGreaterThan(24)
      }
    }
  })

  it('掌丘只收偏离中和的 —— 中和的丘没有可说之处，上去只是占位', () => {
    expect(buildPalmMarks(new Map(), ALL_BALANCED).filter((m) => m.kind === 'mount')).toEqual([])

    const marks = buildPalmMarks(new Map(), { ...ALL_BALANCED, 金星丘: 'high' })
    const mounts = marks.filter((m) => m.kind === 'mount')
    expect(mounts).toHaveLength(1)
    expect(mounts[0].name).toBe('金星丘')
    expect(mounts[0].featureId).toBe('hand.mount.venus')
    // 掌丘接在六条主线之后
    expect(mounts[0].n).toBe(7)
    expect(mounts[0].anchor).toEqual({
      x: MOUNTS.金星丘.x * CANVAS.W,
      y: MOUNTS.金星丘.y * CANVAS.H,
    })
  })

  it('unavailable 的掌丘也不收 —— 没测到不等于偏离中和', () => {
    const marks = buildPalmMarks(new Map(), { ...ALL_BALANCED, 月丘: 'unavailable' })
    expect(marks.filter((m) => m.kind === 'mount')).toEqual([])
  })

  it('序号连续无重复，featureId 与 rules 层的 id 规则一致', () => {
    const marks = buildPalmMarks(FOUR_LINES, {
      ...ALL_BALANCED,
      金星丘: 'high',
      月丘: 'very_low',
    })
    expect(marks.map((m) => m.n)).toEqual(marks.map((_, i) => i + 1))
    expect(new Set(marks.map((m) => m.featureId)).size).toBe(marks.length)
    for (const m of marks) {
      expect(m.featureId).toMatch(m.kind === 'line' ? /^hand\.line\.[a-z]+$/ : /^hand\.mount\.[a-z]+$/)
    }
  })

  it('点数不足两点的线视为未测到 —— 描不出线，也就落不了号', () => {
    const stub = { ...line(0, 0, 1, 1), points: [{ x: 10, y: 10 }] }
    const marks = buildPalmMarks(new Map([['生命线', stub]]), ALL_BALANCED)
    const life = marks.find((m) => m.name === '生命线')!
    expect(life.anchor).toBeNull()
    expect(life.path).toBeUndefined()
  })
})

/* ============================================================
   与 rules 层对齐：每个号都必须能取到词
   ============================================================ */

describe('标号与断语对得上', () => {
  const M = {
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

  type MountsIn = HandRuleInput['mounts']
  const MOUNTS_IN = Object.fromEntries(
    (Object.keys(MOUNTS) as MountName[]).map((k) => [
      k,
      k === '金星丘'
        ? { fullness: 0.85, band: 'high' as const }
        : { fullness: 0.5, band: 'balanced' as const },
    ]),
  ) as MountsIn

  /**
   * 这条是整层的接口测试：图上每个号都得在 features 或 unavailable 里找到对应项。
   * 找不到，界面上就是一个空号 —— 不报错，只是静静地什么都不显示。
   */
  it('每个标号都能在 features 或 unavailable 里落到实处', () => {
    const out = applyHandRules({
      m: M,
      lines: FOUR_LINES,
      mounts: MOUNTS_IN,
      qualityFactor: 0.9,
      detectorScore: 0.95,
      handedness: 'Right',
      dominantHand: 'right',
      handsCaptured: ['right'],
    })

    const marks = buildPalmMarks(FOUR_LINES, out.derived.mountProfile)
    expect(marks.length).toBeGreaterThanOrEqual(7)

    for (const m of marks) {
      const hit =
        out.features.some((f) => f.id === m.featureId || f.id.startsWith(`${m.featureId}.`)) ||
        out.unavailable.some((u) => u.id === m.featureId || u.id.startsWith(`${m.featureId}.`))
      expect(hit, `${m.n} ${m.name}（${m.featureId}）在 features 与 unavailable 里都找不到`).toBe(
        true,
      )
    }
  })

  it('测到的四条主线都取到了断语，不是只在图上有号', () => {
    const out = applyHandRules({
      m: M,
      lines: FOUR_LINES,
      mounts: MOUNTS_IN,
      qualityFactor: 0.9,
      detectorScore: 0.95,
      handedness: 'Right',
      dominantHand: 'right',
      handsCaptured: ['right'],
    })
    const marks = buildPalmMarks(FOUR_LINES, out.derived.mountProfile)

    for (const m of marks.filter((x) => x.anchor && x.kind === 'line')) {
      const items = out.features.filter(
        (f) => f.id === m.featureId || f.id.startsWith(`${m.featureId}.`),
      )
      expect(items.length, `${m.name} 图上有号却没有断语`).toBeGreaterThan(0)
      expect(items[0].label.length).toBeGreaterThan(1)
      expect(items[0].meaning.length).toBeGreaterThan(4)
    }
  })
})
