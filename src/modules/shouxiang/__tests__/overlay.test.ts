/**
 * 掌图标号。
 *
 * 这一层不出判断，因此测的是排版契约：编号稳定、未测到也占号、
 * 徽标必须落在它所指的线上、掌丘只收偏离中和的、每个号都能在 features 里对上词。
 */

import { describe, expect, it } from 'vitest'
import type { MountBand, MountName, PalmLineName } from '@/core/types'
import {
  applyView,
  buildPalmMarks,
  handViewTransform,
  marksToSourceSpace,
  marksToViewSpace,
  type PalmMark,
} from '../overlay'
import { CANVAS, CANVAS_ANCHORS, MOUNTS } from '../landmarks'
import { applyHomography, findHomography } from '@/cv/homography'
import type { P2 } from '@/core/geom'
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

/* ============================================================
   映回原照片
   ============================================================ */

describe('映回原照片', () => {
  /** 一只手的四个锚点在原照片像素里的位置，与 normalizePalm 取的是同一组 */
  const SRC = [
    { x: 380, y: 500 }, // 食指 MCP
    { x: 710, y: 550 }, // 小指 MCP
    { x: 500, y: 920 }, // 腕
    { x: 500, y: 470 }, // 中指 MCP
  ]
  const DST = [
    CANVAS_ANCHORS.indexMcp,
    CANVAS_ANCHORS.pinkyMcp,
    CANVAS_ANCHORS.wrist,
    CANVAS_ANCHORS.middleMcp,
  ]
  const H = findHomography(SRC, DST)
  const frame = { H, mirrored: false, srcWidth: 1000, srcHeight: 1000, scale: 1 }

  const markAt = (p: P2): PalmMark => ({
    n: 1,
    name: '生命线',
    kind: 'line',
    featureId: 'hand.line.life',
    anchor: p,
    path: [p, p],
  })

  it('逆变换是严格的：画布上的点映回去，正落回它当初来的那个像素', () => {
    for (const src of SRC) {
      const onCanvas = applyHomography(H, src)
      const [back] = marksToSourceSpace([markAt(onCanvas)], frame)
      expect(back.anchor!.x).toBeCloseTo(src.x, 3)
      expect(back.anchor!.y).toBeCloseTo(src.y, 3)
    }
  })

  it('整条描线一起映回去，不只是徽标那一个点', () => {
    const a = applyHomography(H, SRC[0])
    const b = applyHomography(H, SRC[2])
    const m: PalmMark = { ...markAt(a), path: [a, b] }
    const [back] = marksToSourceSpace([m], frame)
    expect(back.path![0].x).toBeCloseTo(SRC[0].x, 3)
    expect(back.path![1].y).toBeCloseTo(SRC[2].y, 3)
  })

  it('左手要把那次水平镜像也撤掉', () => {
    const src = { x: 380, y: 500 }
    const onCanvas = applyHomography(H, src)
    const [back] = marksToSourceSpace([markAt(onCanvas)], { ...frame, mirrored: true })
    // 镜像帧里的 x 应被翻回 srcWidth − 1 − x
    expect(back.anchor!.x).toBeCloseTo(1000 - 1 - src.x, 3)
    expect(back.anchor!.y).toBeCloseTo(src.y, 3)
  })

  it('缩略图的缩放比一并作用到坐标上', () => {
    const src = { x: 380, y: 500 }
    const onCanvas = applyHomography(H, src)
    const [back] = marksToSourceSpace([markAt(onCanvas)], { ...frame, scale: 0.5 })
    expect(back.anchor!.x).toBeCloseTo(src.x * 0.5, 3)
    expect(back.anchor!.y).toBeCloseTo(src.y * 0.5, 3)
  })

  it('映出画面的标号不落 —— 宁可不标，也不指到照片外面去', () => {
    // 画布左上角之外的一点，逆变换后大概率落在原照片之外
    const far = { x: -4000, y: -4000 }
    const [back] = marksToSourceSpace([markAt(far)], frame)
    expect(back.anchor).toBeNull()
  })

  it('未测到的线映回去仍然是未测到', () => {
    const m: PalmMark = { n: 5, name: '太阳线', kind: 'line', featureId: 'hand.line.sun', anchor: null }
    const [back] = marksToSourceSpace([m], frame)
    expect(back.anchor).toBeNull()
    expect(back.path).toBeUndefined()
  })

  it('序号、名称、featureId 一律不变 —— 这一步只动坐标', () => {
    const marks = buildPalmMarks(FOUR_LINES, { ...ALL_BALANCED, 金星丘: 'high' })
    const back = marksToSourceSpace(marks, frame)
    expect(back.map((m) => m.n)).toEqual(marks.map((m) => m.n))
    expect(back.map((m) => m.name)).toEqual(marks.map((m) => m.name))
    expect(back.map((m) => m.featureId)).toEqual(marks.map((m) => m.featureId))
  })
})

/* ============================================================
   取景：裁到手上、把手扶正
   ============================================================ */

describe('取景', () => {
  /** 一只手的 21 点（原照片像素）。可整体旋转，用来验证扶正 */
  function handPx(deg = 0, cx = 500, cy = 500): P2[] {
    const base: [number, number][] = [
      [500, 920], [340, 820], [260, 720], [200, 630], [160, 550],
      [380, 500], [360, 380], [350, 300], [340, 230],
      [500, 470], [500, 340], [500, 250], [500, 170],
      [610, 490], [630, 360], [640, 280], [650, 210],
      [710, 550], [750, 440], [770, 380], [790, 320],
    ]
    const r = (deg * Math.PI) / 180
    return base.map(([x, y]) => ({
      x: cx + (x - cx) * Math.cos(r) - (y - cy) * Math.sin(r),
      y: cy + (x - cx) * Math.sin(r) + (y - cy) * Math.cos(r),
    }))
  }

  it('是相似变换 —— 只有旋转与等比缩放，没有透视分量', () => {
    const v = handViewTransform(handPx(), 900)
    // a == d 且 b == −c 正是「旋转 + 等比缩放」的签名；有了它就不可能把手折过去
    expect(v.a).toBeCloseTo(v.d, 10)
    expect(v.b).toBeCloseTo(-v.c, 10)
    expect(v.a * v.d - v.b * v.c).toBeGreaterThan(0)
  })

  it('21 个关键点全部落在画面内 —— 归一化那条路上做不到这一点', () => {
    for (const deg of [0, 25, -40, 90, 180]) {
      const lm = handPx(deg)
      const v = handViewTransform(lm, 900)
      for (const [i, p] of lm.entries()) {
        const q = applyView(v, p)
        expect(q.x, `第 ${i} 点转出画面左右`).toBeGreaterThanOrEqual(0)
        expect(q.x).toBeLessThanOrEqual(v.width)
        expect(q.y, `第 ${i} 点转出画面上下`).toBeGreaterThanOrEqual(0)
        expect(q.y).toBeLessThanOrEqual(v.height)
      }
    }
  })

  it('手被扶正：中指根一定在腕的正上方', () => {
    for (const deg of [0, 37, -62, 150, 180]) {
      const lm = handPx(deg)
      const v = handViewTransform(lm, 900)
      const wrist = applyView(v, lm[0])
      const mid = applyView(v, lm[9])
      expect(mid.y, `${deg}° 时没扶正`).toBeLessThan(wrist.y)
      // 「正上方」：横向偏移相对纵向落差可以忽略
      expect(Math.abs(mid.x - wrist.x)).toBeLessThan(Math.abs(mid.y - wrist.y) * 0.05)
    }
  })

  it('照片怎么歪，取景后都是同一张画面', () => {
    const a = handViewTransform(handPx(0), 900)
    const b = handViewTransform(handPx(53), 900)
    expect(b.width).toBeCloseTo(a.width, 0)
    expect(b.height).toBeCloseTo(a.height, 0)
    // 同一个关键点在两个取景里应落到同一处
    for (const i of [0, 4, 9, 17, 20]) {
      const pa = applyView(a, handPx(0)[i])
      const pb = applyView(b, handPx(53)[i])
      expect(pb.x).toBeCloseTo(pa.x, 0)
      expect(pb.y).toBeCloseTo(pa.y, 0)
    }
  })

  it('长边正好等于给定上限，手填满画面', () => {
    const v = handViewTransform(handPx(), 900)
    expect(Math.max(v.width, v.height)).toBe(900)
  })

  it('标号跟着搬到画面坐标，落到画面外的不落号', () => {
    const v = handViewTransform(handPx(), 900)
    const onHand: PalmMark = {
      n: 1, name: '生命线', kind: 'line', featureId: 'hand.line.life',
      anchor: { x: 420, y: 620 }, path: [{ x: 400, y: 560 }, { x: 440, y: 700 }],
    }
    const offFrame: PalmMark = { ...onHand, n: 2, anchor: { x: -9000, y: -9000 } }
    const [a, b] = marksToViewSpace([onHand, offFrame], v)
    expect(a.anchor).not.toBeNull()
    expect(a.path![0]).not.toEqual(onHand.path![0])
    expect(b.anchor).toBeNull()
  })
})
