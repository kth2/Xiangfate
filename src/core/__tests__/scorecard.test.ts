/**
 * 星级映射的性质测试。
 *
 * 这一层的历史：原来是 0–1 绝对分值表 + `1 + (ratio − 0.1) / 0.8 × 4`，
 * balanced=0.75 经该式恒落在 4.25 → 「各项都中和」一律 4 星，1 星与 2 星从无人拿到，
 * 200 人只有 19 种五维组合。下面每一条都是为了不再回到那个状态。
 */

import { describe, expect, it } from 'vitest'
import { computeScorecard, explainScorecard, EVIDENCE_PRIOR, NEUTRAL_STARS } from '../scorecard'
import { SCORE_DIMENSIONS, type Band, type FeatureItem, type ScoreDimension } from '../types'

function feat(id: string, band: Band, confidence = 1): FeatureItem {
  return {
    id,
    category: '三停',
    label: `${id}·${band}`,
    band,
    value: 1,
    status: 'measured',
    confidence,
    evidence: 'ev',
    meaning: 'me',
    source: null,
  }
}

/** 一组覆盖某维度、权重合计够大的特征，全部给同一档 */
const 执行意志_IDS = ['face.nose.root', 'face.brow.tail', 'face.brow.density']
const wholeDim = (band: Band) => 执行意志_IDS.map((id) => feat(id, band))

describe('刻度零点', () => {
  it('各项都在中和区间 → 正中的 3 星', () => {
    const card = computeScorecard(wholeDim('balanced'))
    expect(card.执行意志).toBe(NEUTRAL_STARS)
  })

  it('一条特征都没有 → 也是 3 星，没测到不等于差', () => {
    const card = computeScorecard([])
    for (const dim of SCORE_DIMENSIONS) expect(card[dim]).toBe(NEUTRAL_STARS)
  })
})

describe('五档全都够得到', () => {
  it('全部偏高 → 5 星', () => {
    expect(computeScorecard(wholeDim('high')).执行意志).toBe(5)
  })

  it('全部显著偏低 → 1 星', () => {
    expect(computeScorecard(wholeDim('very_low')).执行意志).toBe(1)
  })

  it('全部偏低 → 2 星', () => {
    expect(computeScorecard(wholeDim('low')).执行意志).toBe(2)
  })

  it('全部显著偏高 → 2 星：过犹不及，但轻于不足', () => {
    const excess = computeScorecard(wholeDim('very_high')).执行意志
    const deficient = computeScorecard(wholeDim('very_low')).执行意志
    expect(excess).toBe(2)
    // 过盛扣分轻于不足 —— 这是「过犹不及」与「不及」的区别
    expect(excess).toBeGreaterThan(deficient)
  })

  it('1 到 5 星每一档都有办法拿到', () => {
    const reachable = new Set<number>()
    for (const band of ['very_low', 'low', 'balanced', 'high', 'very_high'] as Band[]) {
      reachable.add(computeScorecard(wholeDim(band)).执行意志)
    }
    // very_low→1, low→2, balanced→3, high→5。
    // 4 星要靠**方向相混**：同一维里既有有余也有不足。
    // （只加中和项是加不出 4 星的 —— 中和不进分母，δ 仍是 +1。
    //   这本身是刻意的：那种情形该读作「这一维通篇有余」。）
    reachable.add(
      computeScorecard([
        feat('face.nose.root', 'high'),
        feat('face.brow.tail', 'high'),
        feat('face.brow.density', 'low'),
      ]).执行意志,
    )
    expect([...reachable].sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('证据收缩', () => {
  it('证据薄的维度不会一步跳到极值', () => {
    // 单条、权重 2、置信度 0.5 → E = 1，收缩系数 1/(1+1) = 0.5
    const thin = computeScorecard([feat('face.nose.root', 'very_low', 0.5)]).执行意志
    const thick = computeScorecard(wholeDim('very_low')).执行意志
    expect(thin).toBeGreaterThan(thick)
    expect(thin).toBeLessThan(NEUTRAL_STARS)
  })

  it('证据越厚，同样的偏移离中性越远', () => {
    const one = computeScorecard([feat('face.nose.root', 'high')]).执行意志
    const many = computeScorecard(wholeDim('high')).执行意志
    expect(many).toBeGreaterThanOrEqual(one)
  })

  it('先验是正数 —— 为 0 会让单条特征直接把维度打到两端', () => {
    expect(EVIDENCE_PRIOR).toBeGreaterThan(0)
  })
})

describe('中和项不摊薄真正的偏离', () => {
  it('一条偏高配一堆中和，星数仍然高于 3', () => {
    // 这一条是关键：中和项若进分母，δ 会被摊薄到 0.2 上下，星数回落到 3，
    // 于是「测得越多、越说不出话」——旧实现正是如此。
    const features = [
      feat('face.nose.root', 'high'),
      feat('face.brow.tail', 'balanced'),
      feat('face.brow.density', 'balanced'),
      feat('face.brow.shape', 'balanced'),
    ]
    expect(computeScorecard(features).执行意志).toBeGreaterThan(NEUTRAL_STARS)
  })
})

describe('哪些项不参与', () => {
  it('分类项完全不参与 —— 它不在「有余/不足」这根轴上', () => {
    const withCategorical = computeScorecard([
      feat('face.nose.root', 'high'),
      feat('face.brow.shape', 'categorical'),
      feat('face.eye.sclera', 'categorical'),
    ])
    const without = computeScorecard([feat('face.nose.root', 'high')])
    expect(withCategorical.执行意志).toBe(without.执行意志)
  })

  it('列入 evidenceOnly 的项完全不参与', () => {
    const withBridge = computeScorecard([
      feat('face.nose.root', 'high'),
      feat('face.nose.bridge', 'high'),
    ])
    const without = computeScorecard([feat('face.nose.root', 'high')])
    expect(withBridge.执行意志).toBe(without.执行意志)
  })

  it('三维项不参与', () => {
    const with3d = computeScorecard([
      feat('face.nose.root', 'high'),
      feat('face3d.nose.rootDepth', 'very_high'),
    ])
    const without = computeScorecard([feat('face.nose.root', 'high')])
    expect(with3d.执行意志).toBe(without.执行意志)
  })
})

describe('「没测到」与「测到了但都平实」必须分开', () => {
  it('该维一项都没测到 → neutralFallback', () => {
    const e = explainScorecard([])
    for (const dim of SCORE_DIMENSIONS) {
      expect(e[dim].neutralFallback).toBe(true)
      expect(e[dim].stars).toBe(NEUTRAL_STARS)
    }
  })

  it('测到了但各项都在中和区间 → 同样 3 星，但**不是** neutralFallback', () => {
    // 两者星数一样，要对用户说的话完全不同：
    // 前者「本次没测到足够特征」，后者「各项均在中和区间」。
    const e = explainScorecard(wholeDim('balanced'))
    expect(e.执行意志.stars).toBe(NEUTRAL_STARS)
    expect(e.执行意志.neutralFallback).toBe(false)
    expect(e.执行意志.drivers).toEqual([])
  })

  it('分类项不足以让一维算「测到了」', () => {
    // 分类项完全不参与，因此只有分类项的维度仍算没测到
    const e = explainScorecard([feat('face.brow.shape', 'categorical')])
    expect(e.执行意志.neutralFallback).toBe(true)
  })
})

describe('星级与解释必须一致', () => {
  it('explainScorecard 的星数与 computeScorecard 完全相同', () => {
    const features = [
      feat('face.nose.root', 'very_high'),
      feat('face.brow.tail', 'low'),
      feat('face.mouth.corner', 'high'),
      feat('face.palace.caibo', 'very_low'),
      feat('face.threeCourts.balance', 'balanced'),
      feat('face.shape', 'categorical'),
    ]
    const card = computeScorecard(features)
    const explain = explainScorecard(features)
    for (const dim of SCORE_DIMENSIONS) expect(explain[dim].stars).toBe(card[dim])
  })

  it('中和项不列为驱动项 —— 它既没推高也没拉低', () => {
    const e = explainScorecard([
      feat('face.nose.root', 'high'),
      feat('face.brow.tail', 'balanced'),
    ])
    expect(e.执行意志.drivers.map((d) => d.id)).toEqual(['face.nose.root'])
  })

  it('very_high 记 excess，偏低记 down，偏高记 up', () => {
    const dirs = (band: Band) =>
      explainScorecard([feat('face.nose.root', band)]).执行意志.drivers[0]?.direction
    expect(dirs('high')).toBe('up')
    expect(dirs('very_high')).toBe('excess')
    expect(dirs('low')).toBe('down')
    expect(dirs('very_low')).toBe('down')
  })
})

describe('确定性', () => {
  it('同一组特征每次给同一张星级卡', () => {
    const features = [feat('face.nose.root', 'high'), feat('face.mouth.corner', 'low')]
    const a = computeScorecard(features)
    for (let i = 0; i < 5; i++) {
      expect(computeScorecard(features)).toEqual(a)
    }
  })

  it('特征顺序不影响结果', () => {
    const fs: FeatureItem[] = [
      feat('face.nose.root', 'high'),
      feat('face.brow.tail', 'low'),
      feat('face.mouth.corner', 'very_high'),
    ]
    const forward = computeScorecard(fs)
    const backward = computeScorecard([...fs].reverse())
    expect(backward).toEqual(forward)
  })

  it('星数始终落在 1–5', () => {
    const bands: Band[] = ['very_low', 'low', 'balanced', 'high', 'very_high', 'categorical']
    for (const b of bands) {
      const card = computeScorecard(wholeDim(b))
      for (const dim of SCORE_DIMENSIONS) {
        expect(card[dim]).toBeGreaterThanOrEqual(1)
        expect(card[dim]).toBeLessThanOrEqual(5)
        expect(Number.isInteger(card[dim] as number)).toBe(true)
      }
    }
  })
})

describe('维度之间互不串扰', () => {
  it('只喂某一维的特征，不动其他维', () => {
    const card = computeScorecard([feat('face.mouth.corner', 'very_low')])
    // face.mouth.corner 只挂人际情感
    expect(card.人际情感).toBeLessThan(NEUTRAL_STARS)
    const untouched: ScoreDimension[] = ['气度格局', '才智思辨', '执行意志', '根基福泽']
    for (const dim of untouched) expect(card[dim]).toBe(NEUTRAL_STARS)
  })
})
