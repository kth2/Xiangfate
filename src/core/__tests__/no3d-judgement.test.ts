/**
 * 3D 特征**不参与打分、不产生断语** —— 在拿到真实人群校准的阈值之前。
 *
 * 这不是一句约定，是一条必须被守住的边界：
 * 已经出过一次事 —— face3d.nose.rootDepth 的 label 曾叫「山根隆起」，
 * 与断语表的键撞名，于是每张脸都无条件拿到一条贵格断语「山根隆起，主中年得运」，
 * 而那一项是**有符号**的量，实测可能是负的（山根低陷）。
 *
 * 所以这里同时守三层：
 *   1. 结构：collectVerdicts 直接跳过 face3d.*，不靠名字不撞巧
 *   2. 命名：3D 的 label 不得与断语表的键重名（撞了就是设计信号，早点发现）
 *   3. 打分：把 3D 特征混进去，星级一分都不能变
 */

import { describe, expect, it } from 'vitest'
import { partitionByConfidence } from '../band'
import { computeScorecard } from '../scorecard'
import { collectVerdicts } from '../verdicts'
import { SCORE_DIMENSIONS, type FeatureItem } from '../types'
import { computeFace3DFeatures, FEATURE_MODULES } from '@/modules/mianxiang/features'
import { computeFaceMetrics } from '@/modules/mianxiang/metrics'
import { applyFaceRules } from '@/modules/mianxiang/rules'
import { IMG_H, IMG_W, projectCanonical } from '@/modules/mianxiang/__tests__/canonical'

const LM = projectCanonical()

const threeD: FeatureItem[] = partitionByConfidence(
  computeFace3DFeatures({
    landmarks: LM,
    imgWidth: IMG_W,
    imgHeight: IMG_H,
    qualityFactor: 0.9,
    detectorScore: 0.95,
  }).features,
).features

const twoD: FeatureItem[] = applyFaceRules({
  m: computeFaceMetrics(LM, IMG_W, IMG_H),
  qualityFactor: 0.9,
  complexionFactor: 0,
  detectorScore: 0.95,
  complexion: null,
  browPixels: null,
  foreheadOccluded: false,
  moles: null,
  eyeBags: null,
  nasolabial: null,
}).features

describe('断语', () => {
  it('3D 特征一条断语都不产生', () => {
    expect(threeD.length).toBeGreaterThan(20) // 确认样本非空，否则这条是空测
    expect(collectVerdicts(threeD)).toEqual([])
  })

  it('混进二维特征后，断语与只有二维时完全一致', () => {
    expect(collectVerdicts([...twoD, ...threeD])).toEqual(collectVerdicts(twoD))
  })

  it('即使某条 3D 特征的 label 与断语表重名，也不会被算成断语', () => {
    const trap: FeatureItem = {
      ...threeD[0],
      id: 'face3d.trap',
      label: '三停平均', // 断语表里确实有这个键
    }
    expect(collectVerdicts([trap])).toEqual([])
  })

  it('3D 的 label 不得与断语表的键重名 —— 撞了说明命名把量与判断混为一谈', () => {
    // 用一条已知能产出断语的二维特征，反推断语表认得哪些 label
    const known = new Set(
      twoD.filter((f) => collectVerdicts([f]).length > 0).map((f) => f.label),
    )
    for (const spec of FEATURE_MODULES.flatMap((m) => m.specs)) {
      expect(known.has(spec.label), `${spec.id} 的 label「${spec.label}」与断语表重名`).toBe(false)
    }
  })
})

describe('星级', () => {
  it('把 3D 特征混进去，五维星级一分都不变', () => {
    const base = computeScorecard(twoD)
    const mixed = computeScorecard([...twoD, ...threeD])
    for (const dim of SCORE_DIMENSIONS) {
      expect(mixed[dim], dim).toBe(base[dim])
    }
  })

  it('只有 3D 特征时，打分退化为中性值而不是凭空给分', () => {
    const only3d = computeScorecard(threeD)
    for (const dim of SCORE_DIMENSIONS) {
      expect(only3d[dim], dim).toBeGreaterThanOrEqual(1)
      expect(only3d[dim], dim).toBeLessThanOrEqual(5)
    }
  })
})
