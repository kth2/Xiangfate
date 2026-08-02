/**
 * 五维星级的「来由」。
 *
 * 用户反馈：五维气象只有星级，没有任何解释。星级本身是规则算的，
 * 解释也必须来自同一套规则 —— 否则就成了事后编的说辞。
 * 这里锁住两件事：解释与星级同源、方向判定符合「过犹不及」。
 */

import { describe, expect, it } from 'vitest'
import { computeScorecard, explainScorecard } from '../scorecard'
import { SCORE_DIMENSIONS, type FeatureItem } from '../types'

function feat(p: Partial<FeatureItem> & Pick<FeatureItem, 'id' | 'band'>): FeatureItem {
  return {
    category: '三停',
    label: p.id,
    value: 1,
    status: 'measured',
    confidence: 0.9,
    evidence: 'ev',
    meaning: `${p.id} 的释义`,
    source: '麻衣神相',
    ...p,
  } as FeatureItem
}

describe('explainScorecard', () => {
  it('星级与 computeScorecard 完全一致 —— 不能各算各的', () => {
    const features = [
      feat({ id: 'face.nose.bridge', band: 'high' }),
      feat({ id: 'face.eye.openness', band: 'low' }),
      feat({ id: 'face.brow.length', band: 'very_high' }),
      feat({ id: 'face.mouth.corner', band: 'balanced' }),
      feat({ id: 'face.palace.caibo', band: 'very_low' }),
    ]
    const card = computeScorecard(features)
    const explain = explainScorecard(features)
    for (const dim of SCORE_DIMENSIONS) {
      expect(explain[dim].stars).toBe(card[dim])
    }
  })

  it('very_high 记为 excess 而非 up —— 过盛反损', () => {
    const e = explainScorecard([feat({ id: 'face.nose.bridge', band: 'very_high' })])
    const d = e.执行意志.drivers.find((x) => x.id === 'face.nose.bridge')
    expect(d?.direction).toBe('excess')
    // high 才是纯粹的推高
    const e2 = explainScorecard([feat({ id: 'face.nose.bridge', band: 'high' })])
    expect(e2.执行意志.drivers[0].direction).toBe('up')
  })

  it('偏低的特征记为 down', () => {
    const e = explainScorecard([feat({ id: 'face.eye.openness', band: 'very_low' })])
    expect(e.才智思辨.drivers[0].direction).toBe('down')
  })

  it('落在中和区间的项不列为驱动项', () => {
    const e = explainScorecard([
      feat({ id: 'face.mouth.corner', band: 'balanced' }),
      feat({ id: 'face.mouth.width', band: 'categorical' }),
    ])
    expect(e.人际情感.drivers).toEqual([])
    // 但它们确实参与了计算，不该被当成「没测到」
    expect(e.人际情感.count).toBeGreaterThan(0)
    expect(e.人际情感.neutralFallback).toBe(false)
  })

  it('没有特征的维度标记为中性回落，星级为 3', () => {
    const e = explainScorecard([])
    for (const dim of SCORE_DIMENSIONS) {
      expect(e[dim].neutralFallback).toBe(true)
      expect(e[dim].stars).toBe(3)
      expect(e[dim].drivers).toEqual([])
    }
  })

  it('驱动项按影响力降序，且带上释义与出处供 UI 展示', () => {
    // face.nose.bridge 对执行意志权重 3，face.brow.tail 权重 2
    const e = explainScorecard([
      feat({ id: 'face.brow.tail', band: 'very_low' }),
      feat({ id: 'face.nose.bridge', band: 'very_low' }),
    ])
    const ids = e.执行意志.drivers.map((d) => d.id)
    expect(ids).toEqual(['face.nose.bridge', 'face.brow.tail'])
    for (const d of e.执行意志.drivers) {
      expect(d.meaning).toBeTruthy()
      expect(d.label).toBeTruthy()
    }
  })

  it('置信度低的特征影响力更小', () => {
    const e = explainScorecard([
      feat({ id: 'face.nose.bridge', band: 'very_low', confidence: 0.4 }),
      feat({ id: 'face.brow.tail', band: 'very_low', confidence: 1 }),
    ])
    // 权重 3×0.4=1.2 < 2×1=2，低置信度把高权重项压了下去
    expect(e.执行意志.drivers[0].id).toBe('face.brow.tail')
  })

  it('只取前 N 条', () => {
    const e = explainScorecard(
      [
        feat({ id: 'face.nose.bridge', band: 'low' }),
        feat({ id: 'face.brow.tail', band: 'low' }),
        feat({ id: 'face.nose.root', band: 'low' }),
        feat({ id: 'face.eye.sclera', band: 'low' }),
      ],
      2,
    )
    expect(e.执行意志.drivers).toHaveLength(2)
  })
})
