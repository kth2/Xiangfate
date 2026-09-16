/**
 * 掌部归一化帧的条件数测试。
 *
 * 这一组是被一次实测换来的：一张真实掌照的报告里，生命线只描出一个点，
 * 感情线画到了掌心中段，金星丘的圆压在别处。
 * 追下去根因不在描线，在**帧**：normalizePalm 原先用单应变换，
 * 而四组对应点里有三个（食/中/小指 MCP）挤在指根一线上 —— 单应要求
 * 任意三点不近共线，这里三角形高只有底的 0.109 倍。
 *
 * 夹具 real-palm.fixture.json 就是那只手，MediaPipe 真实输出的 21 点，
 * 只有坐标，没有图像。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { applyHomography, findHomography, fitAffine, invertHomography } from '@/cv/homography'
import { CANVAS, CANVAS_ANCHORS, HAND } from '../landmarks'
import type { P2 } from '@/core/geom'

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./real-palm.fixture.json', import.meta.url)), 'utf8'),
) as { width: number; height: number; landmarks: { x: number; y: number }[] }

const px = (i: number): P2 => ({
  x: fixture.landmarks[i].x * fixture.width,
  y: fixture.landmarks[i].y * fixture.height,
})

const SRC = [px(HAND.indexMcp), px(HAND.pinkyMcp), px(HAND.wrist), px(HAND.middleMcp)]
const DST = [
  CANVAS_ANCHORS.indexMcp,
  CANVAS_ANCHORS.pinkyMcp,
  CANVAS_ANCHORS.wrist,
  CANVAS_ANCHORS.middleMcp,
]

/** 应当落在掌画布之内的点：腕、拇指根两节、四个 MCP。指节在画布之上，本就不算 */
const IN_PALM = [HAND.wrist, HAND.thumbCmc, HAND.thumbMcp, HAND.indexMcp, HAND.middleMcp, HAND.ringMcp, HAND.pinkyMcp]

const inside = (p: P2): boolean => p.x >= 0 && p.x <= CANVAS.W && p.y >= 0 && p.y <= CANVAS.H

/** 把某个锚点挪 d 像素，量画布上最大位移 —— 这就是条件数的实物版 */
function jitterDrift(fit: (s: P2[], d: P2[]) => number[], anchorIdx: number, d = 2): number {
  const A = fit(SRC, DST) as never
  const moved = SRC.map((p, i) => (i === anchorIdx ? { x: p.x + d, y: p.y } : p))
  const B = fit(moved, DST) as never
  let worst = 0
  for (const k of IN_PALM) {
    const a = applyHomography(A, px(k))
    const b = applyHomography(B, px(k))
    worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y))
  }
  return worst
}

describe('锚点配置', () => {
  it('三个 MCP 确实近共线 —— 这正是单应在这里不能用的原因', () => {
    const [a, b, c] = [px(HAND.indexMcp), px(HAND.middleMcp), px(HAND.pinkyMcp)]
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
    const base = Math.hypot(c.x - a.x, c.y - a.y)
    // 高/底 < 0.15 视为近共线。实测这只手是 0.109
    expect((2 * area) / base / base).toBeLessThan(0.15)
  })
})

describe('仿射帧 vs 单应帧（同一只真实的手）', () => {
  it('单应会把大鱼际甩出画布 —— 金星丘与生命线的先验都写在那一块', () => {
    const H = findHomography(SRC, DST)
    const out = IN_PALM.filter((k) => !inside(applyHomography(H, px(k))))
    expect(out).toContain(HAND.thumbCmc)
    expect(out).toContain(HAND.thumbMcp)
  })

  it('仿射把掌内七点全留在画布里', () => {
    const A = fitAffine(SRC, DST)
    for (const k of IN_PALM) {
      const q = applyHomography(A, px(k))
      expect(inside(q), `点 ${k} 落在 (${(q.x / CANVAS.W).toFixed(3)}, ${(q.y / CANVAS.H).toFixed(3)})`).toBe(true)
    }
  })

  it('大鱼际落回金星丘那一侧（x < 0.3），而不是画布之外', () => {
    const A = fitAffine(SRC, DST)
    const thumb = applyHomography(A, px(HAND.thumbMcp))
    expect(thumb.x / CANVAS.W).toBeLessThan(0.3)
    expect(thumb.y / CANVAS.H).toBeGreaterThan(0.4)
  })

  it('锚点抖 2px：仿射位移 < 5px，单应 > 50px —— 同一个人拍两次两套读数的根源', () => {
    const affine = jitterDrift(fitAffine as never, 3)
    const homo = jitterDrift(findHomography as never, 3)
    expect(affine).toBeLessThan(5)
    expect(homo).toBeGreaterThan(50)
    expect(homo / affine).toBeGreaterThan(20)
  })

  it('四个锚点各自抖动，仿射都稳得住', () => {
    for (let i = 0; i < 4; i++) {
      expect(jitterDrift(fitAffine as never, i), `锚点 ${i}`).toBeLessThan(8)
    }
  })

  it('腕点仍落在约定位置 —— 换帧不等于换约定', () => {
    const q = applyHomography(fitAffine(SRC, DST), px(HAND.wrist))
    expect(q.x / CANVAS.W).toBeCloseTo(0.5, 1)
    expect(q.y / CANVAS.H).toBeCloseTo(0.9, 1)
  })

  it('末行是 [0,0,1]，所以没有投影分母，画布折不过去', () => {
    const A = fitAffine(SRC, DST)
    expect([A[6], A[7], A[8]]).toEqual([0, 0, 1])
  })

  it('逆变换能原样映回去 —— 报告页描线靠的就是这一步', () => {
    const A = fitAffine(SRC, DST)
    const inv = invertHomography(A)
    for (const k of IN_PALM) {
      const p = px(k)
      const back = applyHomography(inv, applyHomography(A, p))
      expect(back.x).toBeCloseTo(p.x, 6)
      expect(back.y).toBeCloseTo(p.y, 6)
    }
  })
})

describe('fitAffine', () => {
  it('三点共线时明确报错，而不是悄悄给一个坏矩阵', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]
    expect(() => fitAffine(line, line)).toThrow(/退化|共线/)
  })

  it('少于三组对应点直接拒绝', () => {
    expect(() => fitAffine([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).toThrow()
  })

  it('给一个真正的仿射，能精确解出来', () => {
    const f = (p: P2): P2 => ({ x: 2 * p.x + 0.5 * p.y + 7, y: -0.3 * p.x + 1.5 * p.y - 4 })
    const src = [
      { x: 0, y: 0 },
      { x: 100, y: 5 },
      { x: 10, y: 80 },
      { x: 90, y: 90 },
    ]
    const A = fitAffine(src, src.map(f))
    for (const p of src) {
      const q = applyHomography(A, p)
      expect(q.x).toBeCloseTo(f(p).x, 6)
      expect(q.y).toBeCloseTo(f(p).y, 6)
    }
  })
})
