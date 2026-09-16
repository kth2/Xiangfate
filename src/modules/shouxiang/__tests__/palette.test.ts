/**
 * 配色与标签排版。
 *
 * 配色那一组不是审美测试 —— 它验的是一个可证伪的说法：
 * 「一条线一个颜色，看得出区别」。所以这里真的把颜色换算到 CIE Lab 去量距离，
 * 而不是肉眼看着差不多就写个快照。
 */

import { describe, expect, it } from 'vitest'
import { colorOf, LINE_COLORS, MOUNT_COLOR } from '../palette'
import { labelText, placeLabels } from '../overlay'
import type { PalmMark } from '../overlay'
import type { PalmLineName } from '@/core/types'

/* ---------- 色彩换算（测试自用，不进产物） ---------- */

function toLab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const r = lin((n >> 16) & 255)
  const g = lin((n >> 8) & 255)
  const b = lin(n & 255)
  // sRGB → XYZ（D65），再 → Lab
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}

/** CIE76 色差。~2.3 是「刚能分辨」，这里要求远大于此 */
function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a)
  const [l2, a2, b2] = toLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** WCAG 相对亮度对比度 */
function contrastWithWhite(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L =
    0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return 1.05 / (L + 0.05)
}

/* ---------- 配色 ---------- */

const NAMES = Object.keys(LINE_COLORS) as PalmLineName[]

describe('掌线配色', () => {
  it('六条线各有一个颜色，没有重复', () => {
    expect(new Set(Object.values(LINE_COLORS)).size).toBe(NAMES.length)
  })

  it('两两色差都远超可分辨阈值 —— 相邻两条线颜色像，标注图就白画了', () => {
    const pairs: string[] = []
    for (let i = 0; i < NAMES.length; i++) {
      for (let j = i + 1; j < NAMES.length; j++) {
        const d = deltaE(LINE_COLORS[NAMES[i]], LINE_COLORS[NAMES[j]])
        if (d < 30) pairs.push(`${NAMES[i]} vs ${NAMES[j]} = ${d.toFixed(1)}`)
      }
    }
    expect(pairs, `色差过近：${pairs.join('；')}`).toEqual([])
  })

  it('每个颜色配白字都够对比 —— 名牌是实底白字', () => {
    for (const n of NAMES) {
      expect(contrastWithWhite(LINE_COLORS[n]), n).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrastWithWhite(MOUNT_COLOR)).toBeGreaterThanOrEqual(4.5)
  })

  it('掌丘不占用六条线里的任何一个色相', () => {
    for (const n of NAMES) expect(deltaE(LINE_COLORS[n], MOUNT_COLOR)).toBeGreaterThan(20)
  })

  it('colorOf 认线也认丘，认不出的退到掌丘色而不是抛错', () => {
    expect(colorOf('生命线', 'line')).toBe(LINE_COLORS.生命线)
    expect(colorOf('金星丘', 'mount')).toBe(MOUNT_COLOR)
    expect(colorOf('不存在的线', 'line')).toBe(MOUNT_COLOR)
  })
})

/* ---------- 标签排版 ---------- */

const mark = (n: number, name: string, anchor: { x: number; y: number } | null): PalmMark => ({
  n,
  name,
  kind: 'line',
  featureId: `hand.line.${n}`,
  anchor,
})

/** 等宽假字体：每个字符 10px，排版逻辑与真实字体无关 */
const metrics = {
  measure: (t: string) => t.length * 10,
  fontSize: 20,
  padX: 6,
  padY: 4,
  gap: 8,
}

const area = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

describe('标签排版', () => {
  const bounds = { width: 800, height: 900 }

  it('没有锚点的标号不排牌 —— 未测到的线不该在图上出现', () => {
    const out = placeLabels([mark(1, '生命线', null), mark(2, '智慧线', { x: 400, y: 400 })], bounds, metrics)
    expect(out.map((l) => l.mark.n)).toEqual([2])
  })

  it('牌子始终整块落在画面内', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 0, y: 900 },
      { x: 800, y: 900 },
    ]
    const out = placeLabels(corners.map((c, i) => mark(i + 1, '婚姻线', c)), bounds, metrics)
    expect(out).toHaveLength(4)
    for (const l of out) {
      expect(l.x, JSON.stringify(l)).toBeGreaterThanOrEqual(0)
      expect(l.y).toBeGreaterThanOrEqual(0)
      expect(l.x + l.width).toBeLessThanOrEqual(bounds.width)
      expect(l.y + l.height).toBeLessThanOrEqual(bounds.height)
    }
  })

  it('锚点分散时牌子互不重叠', () => {
    const out = placeLabels(
      [
        mark(1, '生命线', { x: 200, y: 200 }),
        mark(2, '智慧线', { x: 600, y: 300 }),
        mark(3, '感情线', { x: 200, y: 700 }),
        mark(4, '命运线', { x: 600, y: 750 }),
      ],
      bounds,
      metrics,
    )
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        expect(area(out[i], out[j]), `${out[i].mark.name} 压住了 ${out[j].mark.name}`).toBe(0)
      }
    }
  })

  it('锚点挤在一起时宁可稍微重叠，也不丢掉任何一块牌', () => {
    const cluster = ['生命线', '智慧线', '感情线', '命运线', '太阳线'].map((n, i) =>
      mark(i + 1, n, { x: 400 + i, y: 450 + i }),
    )
    const out = placeLabels(cluster, bounds, metrics)
    expect(out, '一块都不能少').toHaveLength(cluster.length)
  })

  it('同样的输入排出同样的版 —— 报告重渲染时图不能跳', () => {
    const marks = [
      mark(1, '生命线', { x: 300, y: 300 }),
      mark(2, '智慧线', { x: 320, y: 320 }),
    ]
    expect(placeLabels(marks, bounds, metrics)).toEqual(placeLabels(marks, bounds, metrics))
  })

  it('牌面写的是「号 + 名」，号留着跟下方列表对得上', () => {
    expect(labelText(mark(3, '感情线', { x: 1, y: 1 }))).toBe('3 感情线')
  })

  it('牌子紧贴锚点，不会飘到画面另一头 —— 不用引线的前提', () => {
    const out = placeLabels([mark(1, '生命线', { x: 400, y: 450 })], bounds, metrics)
    const l = out[0]
    const cx = l.x + l.width / 2
    const cy = l.y + l.height / 2
    expect(Math.hypot(cx - 400, cy - 450)).toBeLessThan(l.width)
  })
})
