/**
 * 跨模块判线一致性。
 *
 * 有几条线在两个模块里各写了一份，因为 guxiang 已经 import 了 mianxiang/landmarks，
 * 反向再引会成环。写两份就有各走各的风险 —— 这里钉住它们相等。
 *
 * 这不是洁癖：下颌角那一对当初正是因为三维模块另拍了一个 90°/160° 的区间，
 * 与两处既有的 125°/145° 口径不一致，导致骨肉指数被系统性拉低。
 */

import { describe, expect, it } from 'vitest'
import { T as FACE } from '../thresholds'
import { T as BONE } from '@/modules/guxiang/thresholds'

describe('下颌角判线两处一致', () => {
  it('方硬线相等', () => {
    expect(FACE.gonialSquare).toBe(BONE.gonialSquare)
  })

  it('圆润线相等', () => {
    expect(FACE.gonialSoft).toBe(BONE.gonialSoft)
  })

  it('方硬线小于圆润线 —— 角越小越方', () => {
    expect(FACE.gonialSquare).toBeLessThan(FACE.gonialSoft)
  })

  it('两线之间留得下可用的刻度', () => {
    // 跨度太小则噪声就能翻档，太大则实测值全挤在一头（原来的 90–160 就是后者）
    const span = FACE.gonialSoft - FACE.gonialSquare
    expect(span).toBeGreaterThanOrEqual(10)
    expect(span).toBeLessThanOrEqual(40)
  })
})
