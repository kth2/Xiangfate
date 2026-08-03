/**
 * 多帧聚合。
 *
 * 这层要防的是「同一个人拍两次，得到两套断语」。
 * 因此最重要的两条断言是：离群帧不能带偏结果，以及抖动必须换算成更低的置信度。
 */

import { describe, expect, it } from 'vitest'
import { medianOfSamples, stabilityOf } from '../frames'

describe('逐叶中位数', () => {
  it('单帧原样返回', () => {
    const one = { a: 1, b: { c: 2 } }
    expect(medianOfSamples([one])).toBe(one)
  })

  it('嵌套结构逐叶取中位数', () => {
    const out = medianOfSamples([
      { a: 1, nested: { b: 10, deep: { c: 100 } } },
      { a: 3, nested: { b: 20, deep: { c: 300 } } },
      { a: 2, nested: { b: 30, deep: { c: 200 } } },
    ])
    expect(out).toEqual({ a: 2, nested: { b: 20, deep: { c: 200 } } })
  })

  it('离群帧带不走结果 —— 这正是用中位数而不是均值的理由', () => {
    const clean = [{ v: 1.0 }, { v: 1.02 }, { v: 0.98 }, { v: 1.01 }]
    const withOutlier = [...clean, { v: 9.9 }] // 糊掉/眨眼的那一帧
    expect(medianOfSamples(withOutlier).v).toBeCloseTo(1.01, 2)

    const mean = withOutlier.reduce((s, x) => s + x.v, 0) / withOutlier.length
    expect(mean).toBeGreaterThan(2) // 均值会被拖到这儿
  })

  it('非数值叶子取第一帧，不做插值', () => {
    const out = medianOfSamples([
      { label: '三停平均', arr: [1, 2], n: 1 },
      { label: '天庭饱满', arr: [3, 4], n: 3 },
    ])
    expect(out.label).toBe('三停平均')
    expect(out.arr).toEqual([1, 2])
    expect(out.n).toBe(2)
  })

  it('空输入直接报错，不静默返回垃圾', () => {
    expect(() => medianOfSamples([])).toThrow()
  })
})

describe('稳定度', () => {
  it('单帧没有帧间信息，不惩罚', () => {
    const s = stabilityOf([{ v: 1 }])
    expect(s.frames).toBe(1)
    expect(s.factor).toBe(1)
  })

  it('几帧完全一致 → 离散度 0，不打折', () => {
    const s = stabilityOf([{ v: 1 }, { v: 1 }, { v: 1 }])
    expect(s.dispersion).toBe(0)
    expect(s.factor).toBe(1)
  })

  it('抖得越厉害，置信度乘数越低', () => {
    const steady = stabilityOf([{ v: 1.0 }, { v: 1.005 }, { v: 0.995 }])
    const shaky = stabilityOf([{ v: 1.0 }, { v: 1.3 }, { v: 0.7 }])
    expect(shaky.dispersion).toBeGreaterThan(steady.dispersion)
    expect(shaky.factor).toBeLessThan(steady.factor)
    expect(shaky.factor).toBeGreaterThanOrEqual(0.6)
  })

  it('乘数有下限 —— 再抖也不至于把所有特征直接抹掉', () => {
    const wild = stabilityOf([{ v: 1 }, { v: 100 }, { v: 0.01 }])
    expect(wild.factor).toBeGreaterThanOrEqual(0.6)
  })

  it('接近 0 的量用绝对离散度，不会因为除以 0 而爆掉', () => {
    const s = stabilityOf([{ v: 0.0000001 }, { v: -0.0000002 }, { v: 0 }])
    expect(Number.isFinite(s.dispersion)).toBe(true)
    expect(s.factor).toBeLessThanOrEqual(1)
  })
})
