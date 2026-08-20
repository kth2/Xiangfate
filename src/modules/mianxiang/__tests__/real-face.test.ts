/**
 * 真人脸回归测试。
 *
 * 规范脸是理想化的几何体，跑得通不代表真实数据跑得对。这里用 MediaPipe
 * FaceLandmarker 在其官方测试图上的**真实输出**，专门盯两类只有真实数据
 * 才暴露得出来的问题：
 *   1. 归一化区间取错 → 指标饱和在 0 或 1（所有人拿到同一个满值判断）
 *   2. 阈值离谱 → 某一档永远命中或永远不命中
 *
 * 这个测试的由来：初稿的鼻部深度区间是拍脑袋定的，规范脸测试全绿，
 * 一上真人脸两个指标直接顶到 1.0。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import type { P3 } from '@/core/geom'
import { computeFaceMetrics } from '../metrics'
import { applyFaceRules } from '../rules'
import { computeFace3DFeatures, FEATURE_REGISTRY } from '../features'
import { computeScorecard } from '@/core/scorecard'

const fx = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/real-face-landmarks.json', import.meta.url)),
    'utf8',
  ),
) as { width: number; height: number; landmarks: [number, number, number][] }

const LM: P3[] = fx.landmarks.map(([x, y, z]) => ({ x, y, z }))
const M = computeFaceMetrics(LM, fx.width, fx.height)
const FACE3D = computeFace3DFeatures({
  landmarks: LM,
  imgWidth: fx.width,
  imgHeight: fx.height,
  qualityFactor: 0.9,
  detectorScore: 0.95,
})

describe('真人脸 · 度量不越界', () => {
  it('归一化到 0–1 的指标不能贴边饱和', () => {
    // 贴边说明区间取错，会让所有人拿到同一个极值判断
    const saturating: [string, number][] = [
      ['准头饱满度', M.nose.tipFullness],
      ['山根高度', M.nose.bridgeHeight],
    ]
    for (const [name, v] of saturating) {
      expect(v, `${name} 饱和在 ${v}，归一化区间需要重设`).toBeGreaterThan(0.02)
      expect(v, `${name} 饱和在 ${v}，归一化区间需要重设`).toBeLessThan(0.98)
    }
  })

  /**
   * 上面那条是**点名**查两项，于是漏掉了别的。
   *
   * face3d.boneFlesh.cheekFullness 就是这么漏过去的：它拿侧廓两点的连线去量
   * 正面颊部，量到的是脸的前后厚度（约 54% IOD），而归一化分母写的是 8%，
   * 于是合成的 fleshiness 恒为 1.0，骨肉指数退化成只由颌线转折决定。
   * 两张实测脸都因此落进「肉胜于骨」——「骨肉」那条组合正是因此被摘掉的。
   *
   * 所以改成**按注册表遍历**：凡是 unit='score' 的合成量都查，不再点名。
   * 新增一个 0–1 合成量却忘了定标，这条会直接红。
   */
  it('所有 0–1 合成量都不贴边 —— 遍历注册表，不点名', () => {
    const scores = FACE3D.features.filter(
      (f) => FEATURE_REGISTRY.get(f.id)?.unit === 'score',
    )
    expect(scores.length, '一个 score 量都没查到，这条测试是空转').toBeGreaterThan(3)

    for (const f of scores) {
      const v = Number(f.value)
      expect(v, `${f.id}（${f.label}）饱和在 ${v}，归一化区间需要重设`).toBeGreaterThan(0.02)
      expect(v, `${f.id}（${f.label}）饱和在 ${v}，归一化区间需要重设`).toBeLessThan(0.98)
    }
  })

  it('颊部矢高有正负之分，且量级合理 —— 它量的是鼓凹，不是脸的厚薄', () => {
    const cheek = FACE3D.features.find((f) => f.id === 'face3d.boneFlesh.cheekFullness')!
    const v = Number(cheek.value)
    // 修好之前这里是 0.542（54% IOD）—— 那是脸的前后厚度，不是颊部的鼓
    expect(Math.abs(v), `颊部矢高 ${v} 过大，多半又量成了前后厚度`).toBeLessThan(0.25)
  })

  it('所有度量都是有限数', () => {
    const walk = (o: unknown): number[] =>
      typeof o === 'number'
        ? [o]
        : o && typeof o === 'object'
          ? Object.values(o).flatMap(walk)
          : []
    for (const v of walk(M)) expect(Number.isFinite(v)).toBe(true)
  })

  it('三停之和为 1，且没有哪一停被压到极端', () => {
    const { upper, middle, lower } = M.threeCourts
    expect(upper + middle + lower).toBeCloseTo(1, 5)
    for (const v of [upper, middle, lower]) {
      expect(v).toBeGreaterThan(0.2)
      expect(v).toBeLessThan(0.5)
    }
  })

  it('比例类度量落在合理量级', () => {
    expect(M.fiveEye).toBeGreaterThan(3.5)
    expect(M.fiveEye).toBeLessThan(8)
    expect(M.innerGap).toBeGreaterThan(0.8)
    expect(M.innerGap).toBeLessThan(2)
    expect(M.mouth.widthOverAlar).toBeGreaterThan(0.8)
    expect(M.contour.gonialAngle).toBeGreaterThan(60)
    expect(M.contour.gonialAngle).toBeLessThan(170)
  })

  it('真人脸不会完全对称，但也不该判成畸形', () => {
    expect(M.symmetryScore).toBeGreaterThan(0.5)
    expect(M.symmetryScore).toBeLessThanOrEqual(1)
  })
})

describe('真人脸 · 规则输出可用', () => {
  const out = applyFaceRules({
    m: M,
    qualityFactor: 0.85,
    complexionFactor: 0,
    detectorScore: 1,
    complexion: null,
    browPixels: null,
    foreheadOccluded: false,
    moles: null,
    eyeBags: null,
    nasolabial: null,
  })

  it('产出足够多的特征', () => {
    expect(out.features.length).toBeGreaterThanOrEqual(14)
  })

  it('分档不能全部挤在同一档 —— 那说明阈值没起作用', () => {
    const bands = new Set(out.features.filter((f) => f.band !== 'categorical').map((f) => f.band))
    expect(bands.size).toBeGreaterThanOrEqual(2)
  })

  it('不出现 very_high 与 very_low 同时刷屏的极端分布', () => {
    const extreme = out.features.filter(
      (f) => f.band === 'very_high' || f.band === 'very_low',
    ).length
    const total = out.features.filter((f) => f.band !== 'categorical').length
    expect(extreme / total).toBeLessThan(0.6)
  })

  it('评分卡不全是 1 星或全是 5 星', () => {
    const sc = computeScorecard(out.features)
    const vals = Object.values(sc)
    expect(new Set(vals).size, `评分全为 ${vals[0]} 星，权重或分档有问题`).toBeGreaterThan(1)
  })

  it('meaning 不含被内容策略禁止的词', () => {
    const banned = ['短命', '克夫', '肝胆', '心术不正', '注定', '必定', '难产', '孤独终老', '狡诈']
    for (const f of out.features) {
      for (const w of banned) expect(f.meaning).not.toContain(w)
    }
  })
})
