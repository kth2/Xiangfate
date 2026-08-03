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
 * 判线余量：测量值离最近的那条分档线有多远，以中和区半宽为单位。
 *
 * 为什么需要它 —— 分档是硬阈值。一个人的印堂落在判线的 0.99 倍，
 * 拿到的是「印堂偏窄，主心量狭窄」这句重话，而且置信度照给不误；
 * 1.01 倍则一句都没有。而阈值本身是工程判断（见 thresholds 里的 CALIBRATE），
 * 判线附近那点差异，测量噪声就能盖过去。
 *
 * 0 = 正压在判线上（两可之间），≥1 = 离判线足够远，可以照直说。
 */
export function bandMargin(value: number, spec: BandSpec): number {
  const scale = (spec.hi - spec.lo) / 2
  if (!(scale > 0)) return 1
  const d = Math.min(
    Math.abs(value - spec.veryLo),
    Math.abs(value - spec.lo),
    Math.abs(value - spec.hi),
    Math.abs(value - spec.veryHi),
  )
  return clamp01(d / scale)
}

/** 余量小于此值即视为「贴近判线，两可之间」 */
export const BORDERLINE_MARGIN = 0.15

export interface Graded {
  band: Band
  /** 见 bandMargin */
  margin: number
  borderline: boolean
  /** 置信度乘数：贴线时最低打七折 */
  confFactor: number
}

/**
 * 分档 + 判线余量，一次给全。
 *
 * 规则层应当用这个而不是裸 toBand —— 它顺带把「这一档到底判得稳不稳」
 * 折进置信度里，贴线的项因此不会以十足的口气写进报告。
 */
export function grade(value: number, spec: BandSpec): Graded {
  const margin = bandMargin(value, spec)
  const borderline = margin < BORDERLINE_MARGIN
  return {
    band: toBand(value, spec),
    margin: round(margin, 3),
    borderline,
    confFactor: borderline ? 0.7 + (0.3 * margin) / BORDERLINE_MARGIN : 1,
  }
}

/** 贴线时追加到 evidence 末尾的实话 */
export const BORDERLINE_NOTE = '（此项贴近分档判线，属两可之间，措辞已相应放软）'

/**
 * 给草稿特征套上判线余量的影响：压低置信度 + 在证据里说明。
 *
 * 规则层的 push 统一走这里，因此不存在「某一条忘了算余量」的可能。
 * value 不是数字（分类项、比例字符串）或没给 spec 的，原样返回。
 */
export function applyMargin(draft: DraftFeature, spec?: BandSpec): DraftFeature {
  if (!spec || typeof draft.value !== 'number') return draft
  const g = grade(draft.value, spec)
  if (!g.borderline) return draft
  return {
    ...draft,
    confidence: round(draft.confidence * g.confFactor),
    evidence: draft.evidence + BORDERLINE_NOTE,
  }
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
