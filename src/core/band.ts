/**
 * 分档与置信度工具。
 * 所有连续量统一映射为 5 档，便于挂接传统术语。详见 docs/02-feature-rules.md 第 0 章。
 */

import type { Band, FeatureItem, FeatureStatus, UnavailableItem } from './types'

/** 低于此置信度的特征降级为 unavailable */
export const MIN_CONFIDENCE = 0.35

/**
 * 中和区间 [lo, hi]，外加显著偏离的边界 [veryLo, veryHi]。
 * 传统相术以「中和为贵、过犹不及」，故 balanced 居中，两端各分两档。
 */
export interface BandSpec {
  veryLo: number
  lo: number
  hi: number
  veryHi: number
}

export function toBand(value: number, spec: BandSpec): Band {
  if (value <= spec.veryLo) return 'very_low'
  if (value < spec.lo) return 'low'
  if (value <= spec.hi) return 'balanced'
  if (value < spec.veryHi) return 'high'
  return 'very_high'
}

/**
 * band → 评分权重。
 * ⚠️ very_high 低于 high 是刻意的：过盛在传统相术里反而减分。
 */
export const BAND_VALUE: Record<Band, number> = {
  very_low: 0.1,
  low: 0.3,
  balanced: 0.75,
  high: 0.9,
  very_high: 0.6,
  categorical: 0.75,
}

/** 方法固有可靠度。几何测量最高，明暗/z 推导次之，气色最低。 */
export const METHOD_PRIOR = {
  /** 关键点直接算出的长度、角度、比例 */
  geometry: 0.95,
  /** 掌纹 CV 管线（实际值由管线响应强度动态给，此为上限） */
  palmline: 0.85,
  /** 用户手动校正确认 */
  userCorrected: 0.7,
  /** 发际线取自网格顶端（landmark 10），与真实发际线有偏差 */
  meshHairline: 0.65,
  /** 轮廓锐度、边缘强度 */
  contour: 0.7,
  /** 灰度占比（眉毛浓密度等） */
  density: 0.65,
  /** z 值 + 明暗梯度推导的「饱满/隆起」 */
  shading: 0.55,
  /** 掌丘饱满度 */
  mount: 0.5,
  /** 头型颅指数（面部网格不覆盖颅顶后脑） */
  cephalic: 0.5,
  /** 气色 —— 全项目可靠度最低，受白平衡与化妆严重干扰 */
  complexion: 0.45,
  /** 耳部（正面照常被头发遮挡且网格无耳廓细节点） */
  ear: 0.4,
} as const

export type MethodPrior = keyof typeof METHOD_PRIOR

/**
 * confidence = qualityFactor × detectorScore × methodPrior
 * 三者相乘，任一环节差都会拉低整体。
 */
export function computeConfidence(
  qualityFactor: number,
  detectorScore: number,
  method: MethodPrior,
): number {
  const raw = clamp01(qualityFactor) * clamp01(detectorScore) * METHOD_PRIOR[method]
  return Math.round(raw * 100) / 100
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 保留 n 位小数，避免 JSON 里出现 0.6800000000000001 这种噪声 */
export function round(v: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

export interface DraftFeature extends Omit<FeatureItem, 'confidence'> {
  confidence: number
  /** 降级为 unavailable 时的说明 */
  lowConfidenceDetail?: string
}

/**
 * 把草稿特征分流成 features / unavailable。
 * 这是「测得到才说，测不到就标记为不可用」原则的执行点 —— 唯一入口，不要绕过。
 */
export function partitionByConfidence(drafts: DraftFeature[]): {
  features: FeatureItem[]
  unavailable: UnavailableItem[]
} {
  const features: FeatureItem[] = []
  const unavailable: UnavailableItem[] = []

  for (const d of drafts) {
    if (d.confidence >= MIN_CONFIDENCE) {
      const { lowConfidenceDetail: _drop, ...item } = d
      features.push({ ...item, confidence: round(d.confidence) })
    } else {
      unavailable.push({
        id: d.id,
        label: d.label,
        reason: 'low_confidence',
        detail:
          d.lowConfidenceDetail ??
          `本次测量置信度仅 ${Math.round(d.confidence * 100)}%，低于可用门槛，故不作论断`,
      })
    }
  }

  return { features, unavailable }
}

/** 供 UI 展示的档位中文名 */
export const BAND_LABEL: Record<Band, string> = {
  very_low: '显著偏低',
  low: '偏低',
  balanced: '中和',
  high: '偏高',
  very_high: '显著偏高',
  categorical: '—',
}

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  measured: '实测',
  inferred: '推估',
  self_reported: '自述',
}
