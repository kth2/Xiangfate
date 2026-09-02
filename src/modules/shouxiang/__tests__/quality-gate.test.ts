/**
 * 手相的两道「测不到就别说」的闸门。
 *
 * 两条都是实测逼出来的 —— 一张手掌照跑出的报告里：
 *   · 四条主线全部命中，而沿线响应只有 0.14，报告照样写「生命线浅短 · 精力有起伏」；
 *   · 月丘的标号直接落在背景地砖上，而它照样出了一个「饱满度」。
 * 两处都不是「测得不准」，是**在量别的东西**却照常出结论。
 */

import { describe, expect, it } from 'vitest'
import type { P2 } from '@/core/geom'
import type { Polyline } from '@/cv/trace'
import type { MountName } from '@/core/types'
import { classifyLines, SIGNAL_FLOOR } from '../palmlines'
import { computeMounts } from '../mounts'
import { applyHandRules, type HandRuleInput } from '../rules'
import { CANVAS, CANVAS_ANCHORS, MOUNTS, MOUNT_RADIUS, type MountKey } from '../landmarks'
import { T } from '../thresholds'
// ImageData 是浏览器 API，Node 里没有；沿用面相测试里那个只带 data/width/height 的替身
import { makeImageData } from '@/modules/mianxiang/__tests__/canonical'

/* ============================================================
   闸门一：沿线响应太弱 → 不算测到
   ============================================================ */

/** 造一条落在生命线先验区里的折线：起点在指根桡侧，终点在腕部 */
function lifeLine(): Polyline {
  const pts: P2[] = []
  const n = 40
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    pts.push({
      x: (0.3 - 0.08 * Math.sin(Math.PI * t)) * CANVAS.W,
      y: (0.25 + 0.6 * t) * CANVAS.H,
    })
  }
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return { points: pts, length: len, gaps: 0, branches: 0 }
}

/** 沿指定折线把响应涂成 value（0–255），其余为 0 */
function responseAlong(line: Polyline, value: number): Float32Array {
  const r = new Float32Array(CANVAS.W * CANVAS.H)
  for (const p of line.points) {
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (x < 0 || y < 0 || x >= CANVAS.W || y >= CANVAS.H) continue
    r[y * CANVAS.W + x] = value
  }
  return r
}

describe('闸门一 · 沿线响应', () => {
  const line = lifeLine()

  it('响应够强：正常归到生命线', () => {
    const out = classifyLines([line], responseAlong(line, 0.6 * 255))
    expect(out.has('生命线')).toBe(true)
    expect(out.get('生命线')!.depth).toBeGreaterThan(SIGNAL_FLOOR)
  })

  it('响应 0.14（实测那次的值）：位置再对也不算测到', () => {
    const out = classifyLines([line], responseAlong(line, 0.14 * 255))
    expect(out.has('生命线'), '碎纹被提名成了生命线').toBe(false)
  })

  it('判线锚在既有的「浅」判线上，不是另拍的数', () => {
    expect(SIGNAL_FLOOR).toBe(T.line.shallow / 2)
    // 真正淡而存在的纹（恰好到「浅」）必须仍然报得出来，否则闸门开得太大
    const out = classifyLines([line], responseAlong(line, T.line.shallow * 255))
    expect(out.has('生命线')).toBe(true)
  })

  it('位置分与信号强弱是两件事 —— 位置满分也挡得住', () => {
    // 同一条折线，只把响应调弱，match 分毫不变
    const strong = classifyLines([line], responseAlong(line, 0.6 * 255))
    expect(strong.get('生命线')!.matchScore).toBeGreaterThanOrEqual(0.45)
    expect(classifyLines([line], responseAlong(line, 0.02 * 255)).size).toBe(0)
  })
})

/* ============================================================
   闸门二：采样圆越过掌缘 → 不出饱满度
   ============================================================ */

/** 整幅均匀灰度的掌图，可在指定处画一块更亮的圆（模拟隆起） */
function palmImage(bright?: { at: P2; r: number }): ImageData {
  const img = makeImageData(CANVAS.W, CANVAS.H)
  for (let y = 0; y < CANVAS.H; y++) {
    for (let x = 0; x < CANVAS.W; x++) {
      const i = (y * CANVAS.W + x) * 4
      // 加一点确定性的纹理，否则标准差为 0，z 分数会被 0 除
      let v = 150 + ((x * 7 + y * 13) % 17)
      if (bright && Math.hypot(x - bright.at.x, y - bright.at.y) < bright.r) v += 40
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  return img
}

describe('闸门二 · 掌丘取样', () => {
  it('月丘与水星丘一律不出结论 —— 它们的采样圆越过了掌缘', () => {
    const { mounts } = computeMounts(palmImage())
    expect(mounts.月丘.band).toBe('unavailable')
    expect(mounts.水星丘.band).toBe('unavailable')
  })

  it('越缘的算术摊开来是站得住的：圆的外沿远出于被锚定的指根线', () => {
    const ulnarKnuckle = CANVAS_ANCHORS.pinkyMcp.x / CANVAS.W // 0.75
    for (const key of ['月丘', '水星丘'] as MountKey[]) {
      expect(MOUNTS[key].x + MOUNT_RADIUS).toBeGreaterThan(ulnarKnuckle + 0.15)
    }
    // 掌心一带的丘不受此影响，仍应照常出数
    const { mounts } = computeMounts(palmImage())
    for (const key of ['木星丘', '土星丘', '太阳丘', '火星丘', '金星丘'] as MountKey[]) {
      expect(mounts[key].band, `${key} 被误挡了`).not.toBe('unavailable')
    }
  })

  it('取样点不足时标为不可用，不再谎称「中和」', () => {
    // 全透明：一个像素都取不到
    const blank = makeImageData(CANVAS.W, CANVAS.H)
    const { mounts } = computeMounts(blank)
    for (const key of Object.keys(MOUNTS) as MountKey[]) {
      expect(mounts[key].band, `${key} 在无像素时给出了 ${mounts[key].band}`).toBe('unavailable')
    }
  })

  it('隆起仍然测得出来 —— 闸门只挡不可信的，不挡真信号', () => {
    const c = { x: MOUNTS.金星丘.x * CANVAS.W, y: MOUNTS.金星丘.y * CANVAS.H }
    const { mounts } = computeMounts(palmImage({ at: c, r: MOUNT_RADIUS * CANVAS.W }))
    expect(['high', 'very_high']).toContain(mounts.金星丘.band)
  })
})

/* ============================================================
   规则层：不可用的丘进 unavailable，不进 features
   ============================================================ */

describe('不可用的掌丘不进断语', () => {
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

  it('unavailable 的丘既不出饱满度，也在 mountProfile 里如实标注', () => {
    const out = applyHandRules({
      m: M,
      lines: new Map(),
      mounts: computeMounts(palmImage()).mounts,
      qualityFactor: 0.9,
      detectorScore: 0.95,
      handedness: 'Right',
      dominantHand: 'right',
      handsCaptured: ['right'],
    })

    for (const key of ['月丘', '水星丘'] as MountName[]) {
      expect(out.features.some((f) => f.label.startsWith(key))).toBe(false)
      expect(out.unavailable.some((u) => u.label === key), `${key} 没有进 unavailable`).toBe(true)
      expect(out.derived.mountProfile[key]).toBe('unavailable')
    }
    // 其余的丘照常出断语
    expect(out.features.some((f) => f.label.startsWith('金星丘'))).toBe(true)
  })
})
