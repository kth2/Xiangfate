/**
 * 本地五维评分卡。
 *
 * ⚠️ 刻意**不让 AI 生成**：同一张照片必须每次得到同样的星级。
 * 生成式模型做不到这一点，所以这件事归代码。
 *
 * 公式（docs/02 第五章）：
 *   dimensionScore = Σ(weight × bandValue × confidence) / Σ(weight × confidence)
 * 其中 bandValue 的 very_high 低于 high —— 传统相术「过犹不及」，过盛反而减分。
 */

import { BAND_VALUE } from './band'
import {
  SCORE_DIMENSIONS,
  type Classic,
  type FeatureItem,
  type ScoreDimension,
  type Scorecard,
} from './types'

/** 特征 id 前缀 → 各维度权重。同一条特征可以贡献多个维度 */
type WeightMap = Record<string, Partial<Record<ScoreDimension, number>>>

const FACE_WEIGHTS: WeightMap = {
  'face.threeCourts': { 气度格局: 3, 根基福泽: 1 },
  'face.fiveEye': { 气度格局: 2 },
  'face.innerGap': { 气度格局: 1, 才智思辨: 1 },
  'face.symmetry': { 气度格局: 2 },
  'face.fiveElements': { 气度格局: 2 },
  'face.shape': { 气度格局: 1 },
  'face.brow.length': { 人际情感: 3 },
  'face.brow.shape': { 人际情感: 1, 执行意志: 1 },
  'face.brow.density': { 执行意志: 1, 人际情感: 1 },
  'face.brow.tail': { 执行意志: 2 },
  'face.eye.shape': { 才智思辨: 1, 人际情感: 1 },
  'face.eye.openness': { 才智思辨: 3 },
  'face.eye.sclera': { 执行意志: 1 },
  'face.nose.bridge': { 执行意志: 3 },
  'face.nose.root': { 执行意志: 2, 才智思辨: 1 },
  'face.nose.alar': { 根基福泽: 2 },
  'face.mouth.width': { 人际情感: 2 },
  'face.mouth.corner': { 人际情感: 3 },
  'face.mouth.lip': { 人际情感: 1 },
  'face.mouth.philtrum': { 根基福泽: 2 },
  'face.palace.mingGong': { 才智思辨: 2, 气度格局: 1 },
  'face.palace.caibo': { 根基福泽: 3 },
  'face.palace.tianzhai': { 人际情感: 1, 根基福泽: 2 },
  'face.complexion': { 根基福泽: 1, 气度格局: 1 },
}

const HAND_WEIGHTS: WeightMap = {
  'hand.type': { 气度格局: 2, 才智思辨: 1 },
  'hand.line.life': { 根基福泽: 3, 执行意志: 1 },
  'hand.line.head': { 才智思辨: 3 },
  'hand.line.heart': { 人际情感: 3 },
  'hand.line.fate': { 执行意志: 3, 气度格局: 1 },
  'hand.line.sun': { 气度格局: 1 },
  'hand.finger.thumb': { 执行意志: 2 },
  'hand.finger.index': { 气度格局: 1, 执行意志: 1 },
  'hand.finger.little': { 人际情感: 2 },
  'hand.mount.jupiter': { 气度格局: 1 },
  'hand.mount.venus': { 根基福泽: 2 },
  'hand.mount.mercury': { 人际情感: 1 },
  'hand.mount.moon': { 才智思辨: 1 },
}

const BONE_WEIGHTS: WeightMap = {
  'bone.headShape': { 气度格局: 2, 才智思辨: 1 },
  'bone.zygomatic': { 执行意志: 2, 气度格局: 1 },
  'bone.frontal': { 才智思辨: 3 },
  'bone.mandible': { 执行意志: 3 },
  'bone.boneFlesh': { 气度格局: 3, 根基福泽: 1 },
  'bone.thickness': { 执行意志: 1, 根基福泽: 1 },
  'bone.shoulder': { 气度格局: 2 },
  'bone.spine': { 气度格局: 1, 执行意志: 1 },
}

const BODY_WEIGHTS: WeightMap = {
  'body.somatotype': { 气度格局: 2, 执行意志: 1 },
  'body.proportion.upperLower': { 才智思辨: 1, 执行意志: 1 },
  'body.proportion.shoulderHip': { 气度格局: 2 },
  'body.posture.trunk': { 气度格局: 2, 执行意志: 2 },
  'body.posture.shoulder': { 气度格局: 1 },
  'body.posture.stance': { 根基福泽: 2 },
  'body.neck': { 气度格局: 1 },
  'body.skin': { 根基福泽: 1 },
  'body.survey.voice': { 人际情感: 2 },
  'body.survey.pace': { 人际情感: 1 },
  'body.survey.dress': { 人际情感: 1, 气度格局: 1 },
}

const WEIGHTS: WeightMap = {
  ...FACE_WEIGHTS,
  ...HAND_WEIGHTS,
  ...BONE_WEIGHTS,
  ...BODY_WEIGHTS,
}

/** 找到最长匹配的前缀，允许 rules 里加子级 id 而不必改这张表 */
function weightsFor(id: string): Partial<Record<ScoreDimension, number>> | undefined {
  if (WEIGHTS[id]) return WEIGHTS[id]
  let best: string | undefined
  for (const key of Object.keys(WEIGHTS)) {
    if (id.startsWith(key + '.') && (!best || key.length > best.length)) best = key
  }
  return best ? WEIGHTS[best] : undefined
}

/**
 * 算五维星级。
 * 特征不足的维度回落到 3 星（中性），而不是 0 星 —— 没测到不等于差。
 */
export function computeScorecard(features: FeatureItem[]): Scorecard {
  const num: Record<ScoreDimension, number> = blank()
  const den: Record<ScoreDimension, number> = blank()

  for (const f of features) {
    const w = weightsFor(f.id)
    if (!w) continue
    const v = BAND_VALUE[f.band]
    for (const [dim, weight] of Object.entries(w) as [ScoreDimension, number][]) {
      num[dim] += weight * v * f.confidence
      den[dim] += weight * f.confidence
    }
  }

  const out = {} as Scorecard
  for (const dim of SCORE_DIMENSIONS) {
    // 权重和过低说明该维度基本没测到，给中性 3 星
    if (den[dim] < 0.5) {
      out[dim] = 3
      continue
    }
    const ratio = num[dim] / den[dim]
    // ratio 落在 [0.1, 0.9]，映射到 1–5 星
    out[dim] = Math.min(5, Math.max(1, Math.round(1 + ((ratio - 0.1) / 0.8) * 4)))
  }
  return out
}

/* ============================================================
   星级的来由
   ============================================================ */

/** balanced 的分值，用作「中和线」—— 传统相术以中和为贵 */
const NEUTRAL = BAND_VALUE.balanced

export interface DimensionDriver {
  id: string
  /** 传统术语，如「天庭饱满」 */
  label: string
  /** 该条相理的释义 */
  meaning: string
  source: Classic | null
  /**
   * 相对中和线的方向。
   * ⚠️ very_high 记 'excess' 而非 'up'：过盛在传统相术里反而减分，
   * 直接标成「减分」会让用户以为测错了，得说清楚是「过犹不及」。
   */
  direction: 'up' | 'down' | 'excess'
  /** 对该维度的影响力，用于排序 */
  influence: number
}

export interface DimensionExplain {
  stars: number
  /** 参与该维度计算的特征条数 */
  count: number
  /** 特征太少、星级取的是中性回落值 */
  neutralFallback: boolean
  /** 影响最大的几条，已排序 */
  drivers: DimensionDriver[]
}

/**
 * 拆解每一维的星级是怎么来的。
 *
 * 与 computeScorecard 用同一张权重表、同一套 band 分值，因此展示出来的
 * 理由和星级必然一致 —— 不是事后编的解释，就是计算过程本身。
 * 同样不经 AI：同一张照片每次给出同样的理由。
 */
export function explainScorecard(
  features: FeatureItem[],
  topN = 3,
): Record<ScoreDimension, DimensionExplain> {
  const scorecard = computeScorecard(features)
  const buckets: Record<ScoreDimension, DimensionDriver[]> = {
    气度格局: [],
    才智思辨: [],
    人际情感: [],
    执行意志: [],
    根基福泽: [],
  }
  const den: Record<ScoreDimension, number> = blank()

  for (const f of features) {
    const w = weightsFor(f.id)
    if (!w) continue
    const v = BAND_VALUE[f.band]
    for (const [dim, weight] of Object.entries(w) as [ScoreDimension, number][]) {
      den[dim] += weight * f.confidence
      // 正好落在中和线上的（balanced / categorical）不算驱动项：
      // 它们既没往上推也没往下拉，列出来只会稀释真正的理由
      if (v === NEUTRAL) continue
      buckets[dim].push({
        id: f.id,
        label: f.label,
        meaning: f.meaning,
        source: f.source,
        direction: f.band === 'very_high' ? 'excess' : v > NEUTRAL ? 'up' : 'down',
        influence: weight * f.confidence * Math.abs(v - NEUTRAL),
      })
    }
  }

  const out = {} as Record<ScoreDimension, DimensionExplain>
  for (const dim of SCORE_DIMENSIONS) {
    const drivers = buckets[dim]
      .sort((a, b) => b.influence - a.influence || a.id.localeCompare(b.id))
      .slice(0, topN)
    out[dim] = {
      stars: scorecard[dim],
      count: features.filter((f) => weightsFor(f.id)?.[dim] !== undefined).length,
      // 与 computeScorecard 里的回落条件保持一致
      neutralFallback: den[dim] < 0.5,
      drivers,
    }
  }
  return out
}

function blank(): Record<ScoreDimension, number> {
  return {
    气度格局: 0,
    才智思辨: 0,
    人际情感: 0,
    执行意志: 0,
    根基福泽: 0,
  }
}

/* ============================================================
   五维在传统相术里各主什么
   ============================================================ */

export interface DimensionMeaning {
  /** 白话一句，说清这一维在讲什么 */
  brief: string
  /** 传统体系中大致对应的范畴 */
  scope: string
  /**
   * 相理释义，1–2 句。
   * 用「主／多主／宜」句式，不下绝对判断 —— 传统相书本身也是这么说话的。
   */
  traditional: string
  source: Classic
}

/**
 * 这五维不是凭空造的现代标签，各自对应传统相法里的一组部位与宫位。
 * 之前这里只有一句干巴巴的现代白话（「整体格局与气象」），
 * 用户看不出它和相术有什么关系，也就无从判断这颗星到底在说什么。
 */
export const DIMENSION_MEANING: Record<ScoreDimension, DimensionMeaning> = {
  气度格局: {
    brief: '整体格局与气象',
    scope: '事业格局、社会位置、一生气象',
    traditional:
      '相家论人，先论格局。五岳朝拱、三停匀称者，多主气象开阔、行事有容；格局偏窄者，宜借外缘、稳中求进。',
    source: '麻衣神相',
  },
  才智思辨: {
    brief: '思考与判断的取向',
    scope: '学业、谋虑、见事之明',
    traditional:
      '额主早年学业与思虑，眼神主决断。额广眼清者，多主思路明快、见事在先；反之则宜谋定而后动，不急于表态。',
    source: '神相全编',
  },
  人际情感: {
    brief: '与人相处的方式',
    scope: '情感、交游、人缘',
    traditional:
      '眉为兄弟宫，主交游；口为出纳官，主言语情性。眉清口正者，多主待人和厚、缘分不薄；宜以诚相接，不宜争胜。',
    source: '柳庄相法',
  },
  执行意志: {
    brief: '推动事情的力度',
    scope: '事业推动、行动力、中年主运',
    traditional:
      '鼻为中岳，主一身之权；颧主行事之力。鼻直颧称者，多主有主见、肯任事；过刚者宜留转圜余地，刚极则易折。',
    source: '麻衣神相',
  },
  根基福泽: {
    brief: '积累与稳定性',
    scope: '财帛、根基、晚年运势',
    traditional:
      '地阁主晚景，财帛宫主积蓄。地阁方圆、准头丰隆者，多主根基厚实、渐积而成；单薄者宜早作规划，重在养蓄。',
    source: '水镜神相',
  },
}

/** 各维度的一句话说明，报告页展示用 */
export const DIMENSION_DESC: Record<ScoreDimension, string> = Object.fromEntries(
  SCORE_DIMENSIONS.map((d) => [d, DIMENSION_MEANING[d].brief]),
) as Record<ScoreDimension, string>
