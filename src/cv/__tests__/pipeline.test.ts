/**
 * CV 管线的合成图像测试。
 *
 * 掌纹管线是全项目唯一一段自研图像算法，没有第三方库兜底，
 * 必须用「已知答案」的合成图验证：画几条已知位置的暗线，
 * 看管线能不能把它们追回来。
 */

import { describe, expect, it } from 'vitest'
import {
  adaptiveThreshold,
  clahe,
  close,
  gaborMaxResponse,
  removeSmallComponents,
  thin,
  toGray,
} from '../index'
import { mergeCollinear, simplify, traceSkeleton } from '../trace'
import { applyHomography, findHomography, invertHomography } from '../homography'

const W = 256
const H = 256

/**
 * ImageData 是浏览器 API，Node 里没有。
 * 算子只用到 { data, width, height } 三个字段，最小 shim 即可 ——
 * 比为这几个纯计算测试拉起一整个 jsdom 环境划算得多。
 */
function makeImageData(w: number, h: number): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: 'srgb',
  } as ImageData
}

/** 造一张浅底 + 若干条暗线的图，模拟掌纹 */
function synthPalm(lines: { x1: number; y1: number; x2: number; y2: number }[]): ImageData {
  const img = makeImageData(W, H)
  for (let i = 0; i < img.data.length; i += 4) {
    const base = 190 + (Math.random() - 0.5) * 8
    img.data[i] = base
    img.data[i + 1] = base
    img.data[i + 2] = base * 0.92
    img.data[i + 3] = 255
  }
  for (const l of lines) {
    const steps = Math.ceil(Math.hypot(l.x2 - l.x1, l.y2 - l.y1)) * 2
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = Math.round(l.x1 + (l.x2 - l.x1) * t)
      const y = Math.round(l.y1 + (l.y2 - l.y1) * t)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
          const i = (yy * W + xx) * 4
          img.data[i] = 110
          img.data[i + 1] = 105
          img.data[i + 2] = 100
        }
      }
    }
  }
  return img
}

describe('CLAHE', () => {
  it('输出尺寸不变且值域合法', () => {
    const out = clahe(toGray(synthPalm([])), 8, 2)
    expect(out.width).toBe(W)
    expect(out.data.length).toBe(W * H)
    for (let i = 0; i < out.data.length; i += 997) {
      expect(Number.isFinite(out.data[i])).toBe(true)
      expect(out.data[i]).toBeGreaterThanOrEqual(0)
      expect(out.data[i]).toBeLessThanOrEqual(255)
    }
  })

  it('把低对比度的图拉开对比', () => {
    const flat = makeImageData(W, H)
    for (let i = 0; i < flat.data.length; i += 4) {
      const v = 120 + (i % 40) / 4
      flat.data[i] = v
      flat.data[i + 1] = v
      flat.data[i + 2] = v
      flat.data[i + 3] = 255
    }
    const g = toGray(flat)
    expect(spread(clahe(g, 8, 3).data)).toBeGreaterThan(spread(g.data))
  })
})

describe('Gabor 谷线增强', () => {
  it('暗线位置的响应高于空白区', () => {
    const img = synthPalm([{ x1: 40, y1: 128, x2: 216, y2: 128 }])
    const resp = gaborMaxResponse(clahe(toGray(img), 8, 2))
    expect(resp.data[128 * W + 128]).toBeGreaterThan(resp.data[40 * W + 128])
  })

  it('输出无 NaN / Infinity', () => {
    const resp = gaborMaxResponse(
      clahe(toGray(synthPalm([{ x1: 20, y1: 20, x2: 200, y2: 200 }])), 8, 2),
    )
    for (let i = 0; i < resp.data.length; i += 383) {
      expect(Number.isFinite(resp.data[i])).toBe(true)
    }
  })
})

describe('细化', () => {
  it('把粗线细成 1px 骨架且不断开', () => {
    const bin = new Uint8Array(W * H)
    for (let x = 40; x < 216; x++) {
      for (let dy = -3; dy <= 3; dy++) bin[(128 + dy) * W + x] = 1
    }
    const sk = thin(bin, W, H)

    for (let x = 60; x < 200; x++) {
      let col = 0
      for (let y = 120; y < 136; y++) if (sk[y * W + x]) col++
      expect(col).toBeGreaterThanOrEqual(1)
      expect(col).toBeLessThanOrEqual(2)
    }
    expect(count(sk)).toBeLessThan(count(bin) * 0.4)
  })
})

describe('形态学', () => {
  it('闭运算桥接小断口', () => {
    const bin = new Uint8Array(W * H)
    for (let x = 40; x < 100; x++) bin[128 * W + x] = 1
    for (let x = 103; x < 160; x++) bin[128 * W + x] = 1
    expect(close(bin, W, H, 2)[128 * W + 101]).toBe(1)
  })

  it('移除小连通域，保留大块', () => {
    const bin = new Uint8Array(W * H)
    for (let y = 50; y < 70; y++) for (let x = 50; x < 70; x++) bin[y * W + x] = 1
    bin[200 * W + 200] = 1
    bin[200 * W + 201] = 1
    const out = removeSmallComponents(bin, W, H, 40)
    expect(out[60 * W + 60]).toBe(1)
    expect(out[200 * W + 200]).toBe(0)
  })
})

describe('骨架追踪', () => {
  it('三条互不相交的线追成三条折线', () => {
    const bin = new Uint8Array(W * H)
    for (let x = 30; x < 220; x++) bin[60 * W + x] = 1
    for (let x = 30; x < 220; x++) bin[128 * W + x] = 1
    for (let y = 160; y < 240; y++) bin[y * W + 128] = 1

    const lines = traceSkeleton(bin, W, H).filter((l) => l.length > 20)
    expect(lines.length).toBe(3)
    for (const l of lines) expect(l.points.length).toBeGreaterThanOrEqual(2)
  })

  it('合并方向一致的相邻段', () => {
    const bin = new Uint8Array(W * H)
    for (let x = 30; x < 110; x++) bin[128 * W + x] = 1
    for (let x = 118; x < 220; x++) bin[128 * W + x] = 1

    const raw = traceSkeleton(bin, W, H).filter((l) => l.length > 10)
    expect(raw.length).toBe(2)
    const merged = mergeCollinear(raw, 12, 25)
    expect(merged.length).toBe(1)
    expect(merged[0].gaps).toBe(1)
  })

  it('抽稀保留端点', () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 100 + (i % 2) * 0.4 }))
    const s = simplify(pts, 1.5)
    expect(s.length).toBeLessThan(pts.length)
    expect(s[0]).toEqual(pts[0])
    expect(s[s.length - 1]).toEqual(pts[pts.length - 1])
  })
})

describe('单应变换', () => {
  const src = [
    { x: 10, y: 10 }, { x: 110, y: 20 }, { x: 100, y: 120 }, { x: 5, y: 100 },
  ]
  const dst = [
    { x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 256 }, { x: 0, y: 256 },
  ]

  it('把四个源点精确映射到目标点', () => {
    const M = findHomography(src, dst)
    for (let i = 0; i < 4; i++) {
      const p = applyHomography(M, src[i])
      expect(p.x).toBeCloseTo(dst[i].x, 3)
      expect(p.y).toBeCloseTo(dst[i].y, 3)
    }
  })

  it('逆矩阵能还原', () => {
    const M = findHomography(src, dst)
    const inv = invertHomography(M)
    for (const p of src) {
      const back = applyHomography(inv, applyHomography(M, p))
      expect(back.x).toBeCloseTo(p.x, 3)
      expect(back.y).toBeCloseTo(p.y, 3)
    }
  })

  it('退化的对应点明确报错，而不是给出垃圾结果', () => {
    const degenerate = [
      { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 },
    ]
    expect(() => findHomography(degenerate, dst)).toThrow()
  })
})

describe('端到端：合成掌纹图', () => {
  it('三条已知暗线能被完整管线追回来', () => {
    const img = synthPalm([
      { x1: 40, y1: 70, x2: 210, y2: 85 },
      { x1: 45, y1: 130, x2: 205, y2: 150 },
      { x1: 70, y1: 60, x2: 95, y2: 220 },
    ])

    const resp = gaborMaxResponse(clahe(toGray(img), 8, 2))
    const bin = adaptiveThreshold(resp, 15, 0.35)
    const cleaned = removeSmallComponents(close(bin, W, H, 1), W, H, 40)
    const sk = thin(cleaned, W, H)
    const lines = mergeCollinear(traceSkeleton(sk, W, H), 12, 25)
      .filter((l) => l.length > W * 0.15)
      .sort((a, b) => b.length - a.length)

    expect(lines.length).toBeGreaterThanOrEqual(3)
    for (const l of lines.slice(0, 3)) {
      expect(l.length).toBeGreaterThan(W * 0.35)
    }
  })
})

function count(a: Uint8Array): number {
  let c = 0
  for (const v of a) if (v) c++
  return c
}

function spread(a: Float32Array): number {
  let min = Infinity
  let max = -Infinity
  for (const v of a) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min
}
