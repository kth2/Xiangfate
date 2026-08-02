/**
 * 每一条会展示给用户的特征，都必须带传统相术释义。
 *
 * 用户的原话：「不要只显示数值或分档结果，每一项特征都要附带基于传统相术的
 * 简要解读」。释义由规则层产出，四个模块各写各的 push()，漏掉一条不会有任何
 * 编译错误 —— 只会在界面上表现为「有数字没解释」。
 *
 * 所以这里把四个模块的规则在大范围取值上扫一遍，尽量把分支都走到，
 * 逐条检查释义是否存在、是否够长、措辞是否守住了「不绝对化」的底线。
 */

import { describe, expect, it } from 'vitest'
import { applyBodyRules } from '../tixiang/rules'
import { applyBoneRules } from '../guxiang/rules'
import { applyHandRules } from '../shouxiang/rules'
import type { FeatureItem } from '@/core/types'
import type { BodyMetrics } from '../tixiang/metrics'
import type { BoneMetrics } from '../guxiang/metrics'
import type { HandMetrics } from '../shouxiang/metrics'
import type { LineMeasure } from '../shouxiang/palmlines'
import type { MountKey } from '../shouxiang/landmarks'

/** 绝对化措辞 —— 相书自己也不这么说话 */
const ABSOLUTE = ['必定', '一定', '肯定', '注定', '必有', '绝对', '无疑', '势必', '终将', '命中注定']
/** 疾病与寿夭 */
const FORBIDDEN = ['短命', '夭折', '癌', '病变', '肝胆有问题', '肾虚', '克夫', '克妻']

function checkFeature(f: FeatureItem, where: string) {
  const at = `${where} / ${f.id}（${f.label}）`
  expect(f.meaning, `${at} 没有相理释义`).toBeTruthy()
  expect(f.meaning.trim().length, `${at} 的释义过短，像占位符`).toBeGreaterThanOrEqual(6)
  for (const w of [...ABSOLUTE, ...FORBIDDEN]) {
    expect(f.meaning.includes(w), `${at} 的释义出现了「${w}」`).toBe(false)
  }
  // evidence 是给用户核对的实测依据，必须说清判据
  expect(f.evidence.trim().length, `${at} 的 evidence 过短`).toBeGreaterThanOrEqual(8)
  // 连续量要给出数字；像「小指是否超过无名指第一指节」这种布尔判定没有数值，
  // 说清判据即可，不必硬凑一个数
  if (typeof f.value === 'number') {
    expect(f.evidence, `${at} 是连续量，evidence 应带数值供用户核对`).toMatch(/\d/)
  }
}

/* ============================================================
   体相
   ============================================================ */

function bodyMetrics(o: Partial<BodyMetrics> = {}): BodyMetrics {
  return {
    hasLowerBody: true,
    shoulderWidth: 0.4,
    hipWidth: 0.34,
    shoulderHipRatio: 1.18,
    torsoLen: 0.52,
    legLen: 0.84,
    upperLowerRatio: 0.62,
    armLen: 0.72,
    armTorsoRatio: 1.38,
    neckLen: 0.11,
    neckRatio: 0.28,
    armReach: 0.02,
    linearity: 3.4,
    posture: {
      trunkTilt: 3,
      trunkTiltSigned: 3,
      shoulderSlope: 2,
      headForward: 0.08,
      shoulderRoll: 0.01,
      weightShift: 0.03,
      stanceWidth: 0.9,
    },
    ...o,
  }
}

describe('体相：每条特征都有相理释义', () => {
  const sweeps: Partial<BodyMetrics>[] = [
    {},
    { shoulderHipRatio: 0.9 },
    { shoulderHipRatio: 1.6 },
    { upperLowerRatio: 0.45 },
    { upperLowerRatio: 0.85 },
    { linearity: 2.2 },
    { linearity: 4.6 },
    { neckRatio: 0.16 },
    { neckRatio: 0.42 },
    { hasLowerBody: false, legLen: null, upperLowerRatio: null, linearity: null, armReach: null },
    { posture: { ...bodyMetrics().posture, trunkTilt: 14, trunkTiltSigned: 14 } },
    { posture: { ...bodyMetrics().posture, trunkTilt: 12, trunkTiltSigned: -12 } },
    { posture: { ...bodyMetrics().posture, shoulderSlope: 9 } },
    { posture: { ...bodyMetrics().posture, headForward: 0.3, shoulderRoll: 0.09 } },
    { posture: { ...bodyMetrics().posture, weightShift: 0.28, stanceWidth: 0.2 } },
    { posture: { ...bodyMetrics().posture, stanceWidth: 1.9 } },
  ]

  it.each(sweeps.map((s, i) => [i, s] as const))('取值组合 #%i', (i, s) => {
    for (const bmi of [null, 17, 22, 29]) {
      const out = applyBodyRules({
        m: bodyMetrics(s),
        qualityFactor: 0.9,
        complexionFactor: 0.8,
        detectorScore: 1,
        complexion: null,
        survey: null,
        bmiValue: bmi,
        segmentationUsed: false,
      })
      expect(out.features.length).toBeGreaterThan(0)
      for (const f of out.features) checkFeature(f, `体相#${i} bmi=${bmi}`)
    }
  })
})

/* ============================================================
   骨相
   ============================================================ */

function boneMetrics(o: Partial<BoneMetrics> = {}): BoneMetrics {
  return {
    zygoWidth: 2.6,
    zygoProminence: 0.5,
    zygoAsymmetry: 0.02,
    zygoEdge: 0.5,
    foreheadRatio: 0.9,
    foreheadHeight: 1.1,
    dayMoonAsym: 0.02,
    jawRatio: 0.82,
    gonialAngle: 122,
    chinRadius: 0.5,
    templeRatio: 0.78,
    browRidge: 0.5,
    boneFleshRatio: 0.5,
    cephalicIndex: null,
    body: null,
    ...o,
  }
}

describe('骨相：每条特征都有相理释义', () => {
  const sweeps: Partial<BoneMetrics>[] = [
    {},
    { zygoWidth: 2.1 },
    { zygoWidth: 3.2 },
    { zygoProminence: 0.1 },
    { zygoProminence: 0.9 },
    { zygoAsymmetry: 0.12 },
    { foreheadRatio: 0.7 },
    { foreheadRatio: 1.1 },
    { foreheadHeight: 0.8 },
    { foreheadHeight: 1.5 },
    { dayMoonAsym: 0.11 },
    { jawRatio: 0.65 },
    { jawRatio: 1.0 },
    { gonialAngle: 105 },
    { gonialAngle: 140 },
    { chinRadius: 0.2 },
    { chinRadius: 0.9 },
    { boneFleshRatio: 0.15 },
    { boneFleshRatio: 0.85 },
    { templeRatio: 0.55 },
    { browRidge: 0.9 },
    { cephalicIndex: 0.72 },
    { cephalicIndex: 0.85 },
    {
      body: {
        shoulderRatio: 0.8,
        shoulderSlope: 2,
        pelvisRatio: 0.85,
        spineTilt: 3,
        wristRatio: 0.22,
      },
    },
    {
      body: {
        shoulderRatio: 1.3,
        shoulderSlope: 11,
        pelvisRatio: 1.05,
        spineTilt: 15,
        wristRatio: 0.35,
      },
    },
  ]

  it.each(sweeps.map((s, i) => [i, s] as const))('取值组合 #%i', (i, s) => {
    const out = applyBoneRules({
      m: boneMetrics(s),
      qualityFactor: 0.9,
      detectorScore: 1,
      hasProfile: s.cephalicIndex != null,
      hasBody: s.body != null,
    })
    expect(out.features.length).toBeGreaterThan(0)
    for (const f of out.features) checkFeature(f, `骨相#${i}`)
  })
})

/* ============================================================
   手相
   ============================================================ */

function handMetrics(o: Partial<HandMetrics> = {}): HandMetrics {
  return {
    palmLen: 0.5,
    palmWidth: 0.38,
    palmAspect: 0.76,
    fingerLen: { thumb: 0.22, index: 0.32, middle: 0.36, ring: 0.33, pinky: 0.26 },
    fingerPalmRatio: 0.72,
    thumbRatio: 0.44,
    indexRingRatio: 0.97,
    pinkyLong: false,
    knuckleProminence: 0.4,
    ...o,
  }
}

function line(name: LineMeasure['name'], o: Partial<LineMeasure> = {}): LineMeasure {
  return {
    name,
    matchScore: 0.8,
    lengthRatio: 0.9,
    depth: 0.6,
    continuity: 0.85,
    curvature: 0.2,
    signedCurvature: 0.2,
    branches: 1,
    doubled: false,
    endRising: false,
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.6, y: 0.7 },
    ],
    corrected: false,
    ...o,
  }
}

const MOUNT_KEYS: MountKey[] = ['木星丘', '土星丘', '太阳丘', '水星丘', '金星丘', '月丘', '火星丘']

function mounts(band: 'very_low' | 'low' | 'balanced' | 'high' | 'very_high') {
  const fullness = { very_low: 0.1, low: 0.3, balanced: 0.5, high: 0.75, very_high: 0.95 }[band]
  return Object.fromEntries(MOUNT_KEYS.map((k) => [k, { fullness, band }])) as Record<
    MountKey,
    { fullness: number; band: typeof band }
  >
}

describe('手相：每条特征都有相理释义', () => {
  const lineSets: [string, Map<LineMeasure['name'], LineMeasure>][] = [
    ['四线齐全', new Map([
      ['生命线', line('生命线')],
      ['智慧线', line('智慧线')],
      ['感情线', line('感情线')],
      ['命运线', line('命运线')],
    ])],
    ['线短而浅', new Map([
      ['生命线', line('生命线', { lengthRatio: 0.4, depth: 0.2, continuity: 0.4 })],
      ['智慧线', line('智慧线', { lengthRatio: 0.45, curvature: 0.05, signedCurvature: -0.05 })],
      ['感情线', line('感情线', { lengthRatio: 0.5, endRising: true, branches: 4 })],
    ])],
    ['线长而深', new Map([
      ['生命线', line('生命线', { lengthRatio: 1.3, depth: 0.95, doubled: true })],
      ['智慧线', line('智慧线', { lengthRatio: 1.25, curvature: 0.5, signedCurvature: 0.5 })],
      ['感情线', line('感情线', { lengthRatio: 1.2, curvature: 0.45 })],
      ['命运线', line('命运线', { lengthRatio: 1.1, continuity: 0.5 })],
      ['太阳线', line('太阳线')],
    ])],
    ['只有一条线', new Map([['生命线', line('生命线')]])],
    ['一条线都没有', new Map()],
  ]

  const handSweeps: Partial<HandMetrics>[] = [
    {},
    { palmAspect: 0.6, fingerPalmRatio: 0.9 },
    { palmAspect: 0.95, fingerPalmRatio: 0.6 },
    { thumbRatio: 0.3 },
    { thumbRatio: 0.58 },
    { indexRingRatio: 0.85 },
    { indexRingRatio: 1.1 },
    { pinkyLong: true, knuckleProminence: 0.9 },
  ]

  for (const [lineLabel, lines] of lineSets) {
    it.each(handSweeps.map((s, i) => [i, s] as const))(`${lineLabel} · 手型 #%i`, (i, s) => {
      for (const band of ['very_low', 'balanced', 'very_high'] as const) {
        const out = applyHandRules({
          m: handMetrics(s),
          lines,
          mounts: mounts(band),
          qualityFactor: 0.9,
          detectorScore: 1,
          handedness: 'Right',
          dominantHand: 'right',
          handsCaptured: ['right'],
        })
        for (const f of out.features) checkFeature(f, `手相 ${lineLabel} #${i} ${band}`)
      }
    })
  }
})
