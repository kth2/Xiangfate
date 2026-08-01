/**
 * 体相：度量 → FeatureItem。
 *
 * ⚠️ 内容策略要点（docs/07）：
 * · kanxiang 原文「五、身高与比例」整节已删 —— 身高不可测，且原文带身材歧视
 * · 体型的「健康提示」里所有疾病名已删，只留生活方式建议
 * · 体态问题（圆肩、重心偏移）只写成日常姿态提醒，不写成骨骼疾病
 * · 「乳房」整节已删
 */

import {
  computeConfidence,
  partitionByConfidence,
  round,
  toBand,
  type DraftFeature,
} from '@/core/band'
import type {
  Classic,
  FeatureCategory,
  Somatotype,
  TixiangDerived,
  UnavailableItem,
} from '@/core/types'
import type { ComplexionResult } from '@/core/color'
import type { BodyMetrics } from './metrics'
import { T } from './thresholds'
import type { SurveyAnswers } from './survey'

export interface BodyRuleInput {
  m: BodyMetrics
  qualityFactor: number
  complexionFactor: number
  detectorScore: number
  complexion: ComplexionResult | null
  survey: SurveyAnswers | null
  bmiValue: number | null
  segmentationUsed: boolean
}

export interface BodyRuleOutput {
  features: import('@/core/types').FeatureItem[]
  unavailable: UnavailableItem[]
  derived: TixiangDerived
}

export function applyBodyRules(input: BodyRuleInput): BodyRuleOutput {
  const { m, qualityFactor, complexionFactor, detectorScore, complexion, survey, bmiValue } = input
  const drafts: DraftFeature[] = []
  const unavailable: UnavailableItem[] = []

  const conf = (method: Parameters<typeof computeConfidence>[2], q = qualityFactor) =>
    computeConfidence(q, detectorScore, method)

  const push = (
    id: string, category: FeatureCategory, label: string, band: DraftFeature['band'],
    value: string | number, status: DraftFeature['status'], confidence: number,
    evidence: string, meaning: string, source: Classic | null,
  ) => drafts.push({ id, category, label, band, value, status, confidence, evidence, meaning, source })

  /* ============ 身体比例 ============ */
  const shBand = toBand(m.shoulderHipRatio, T.shoulderHip)
  push(
    'body.proportion.shoulderHip', '身体比例',
    m.shoulderHipRatio >= T.shoulderBroad ? '肩阔' : m.shoulderHipRatio <= T.shoulderNarrow ? '肩髋相称' : '肩背端正',
    shBand, round(m.shoulderHipRatio), 'measured', conf('geometry'),
    `肩宽为髋宽的 ${m.shoulderHipRatio.toFixed(2)} 倍（世界坐标实测，与拍摄距离无关）`,
    m.shoulderHipRatio >= T.shoulderBroad
      ? '格局开阔，能担当，做事有承托力'
      : m.shoulderHipRatio <= T.shoulderNarrow
        ? '亲和包容，重和谐，与人相处不带压迫感'
        : '体格匀称，进退有度',
    '冰鉴',
  )

  if (m.upperLowerRatio !== null) {
    const ulBand = toBand(m.upperLowerRatio, T.upperLower)
    push(
      'body.proportion.upperLower', '身体比例',
      m.upperLowerRatio >= T.upperLong ? '上身见长' : m.upperLowerRatio <= T.lowerLong ? '下身见长' : '上下相称',
      ulBand, round(m.upperLowerRatio), 'measured', conf('geometry'),
      `躯干长为腿长的 ${m.upperLowerRatio.toFixed(2)} 倍`,
      m.upperLowerRatio >= T.upperLong
        ? '偏思考型，善于谋划与统筹'
        : m.upperLowerRatio <= T.lowerLong
          ? '偏行动型，执行力强，说做就做'
          : '思与行并重，节奏协调',
      '神相全编',
    )
  } else {
    unavailable.push({
      id: 'body.proportion.upperLower', label: '上下身比例', reason: 'not_captured',
      detail: '本次只拍到上半身，腿部长度无法测量',
    })
  }

  const neckBand = toBand(m.neckRatio, T.neck)
  push(
    'body.neck', '身体比例',
    neckBand === 'high' || neckBand === 'very_high' ? '长颈' : neckBand === 'balanced' ? '颈项适中' : '短颈',
    neckBand, round(m.neckRatio), 'measured', conf('geometry'),
    `颈长为肩宽的 ${(m.neckRatio * 100).toFixed(0)}%`,
    neckBand === 'high' || neckBand === 'very_high'
      ? '气质舒展，举止从容'
      : neckBand === 'balanced'
        ? '体态匀称，不疾不徐'
        : '稳重务实，行动干脆',
    '冰鉴',
  )

  if (m.armReach !== null) {
    const near = Math.abs(m.armReach) < 0.15
    push(
      'body.proportion.armReach', '身体比例',
      near ? '手垂大腿中部' : m.armReach > 0 ? '臂略长' : '臂略短',
      near ? 'balanced' : 'low', round(m.armReach), 'measured', conf('geometry'),
      `双腕位置相对大腿中点偏移为大腿长的 ${(m.armReach * 100).toFixed(0)}%`,
      near ? '比例协调，传统视为平衡发展之相' : '肢体比例自有特点，行动方式偏个人化',
      '人伦大统赋',
    )
  }

  /* ============ 体型 ============ */
  const soma = classifySomatotype(m, bmiValue)
  push(
    'body.somatotype', '体型', soma.primary, 'categorical', soma.primary, 'measured',
    conf(bmiValue ? 'geometry' : 'contour'),
    `肩髋比 ${m.shoulderHipRatio.toFixed(2)}，肩宽躯干比 ${(m.shoulderWidth / m.torsoLen).toFixed(2)}` +
      (m.linearity ? `，线性度 ${m.linearity.toFixed(2)}` : '') +
      (bmiValue ? `，据你自述的身高体重换算 BMI ${bmiValue}` : ''),
    SOMA_MEANING[soma.primary], '神相全编',
  )

  /* ============ 体态 ============ */
  const p = m.posture
  const upright = p.trunkTilt <= T.posture.uprightTilt && p.shoulderSlope <= T.posture.shoulderSlope
  const postureLabel: TixiangDerived['posture']['label'] = upright
    ? '直立挺拔'
    : p.trunkTiltSigned > T.posture.leanTilt
      ? '微微前倾'
      : p.trunkTiltSigned < -T.posture.leanTilt
        ? '微微后仰'
        : p.weightShift !== null && p.weightShift > T.posture.weightShift
          ? '重心偏移'
          : '体态待观察'

  push(
    'body.posture.trunk', '体态', postureLabel,
    upright ? 'high' : 'balanced', round(p.trunkTilt, 1), 'measured', conf('geometry'),
    `躯干轴与铅垂线夹角 ${p.trunkTilt.toFixed(1)}°，肩线倾角 ${p.shoulderSlope.toFixed(1)}°`,
    upright
      ? '自信稳重，气场沉着，《冰鉴》所谓形神兼备'
      : postureLabel === '微微前倾'
        ? '积极进取，富有热情，做事往前赶'
        : postureLabel === '微微后仰'
          ? '放松自信，不拘小节'
          : '体态各有其势，可留意日常习惯',
    '冰鉴',
  )

  if (p.shoulderSlope > T.posture.shoulderSlope) {
    push(
      'body.posture.shoulder', '体态', '肩线微斜', 'low', round(p.shoulderSlope, 1),
      'measured', conf('geometry'),
      `左右肩高度差换算为倾角 ${p.shoulderSlope.toFixed(1)}°`,
      '传统主性情随和；日常也可留意一下惯用侧的负重习惯',
      '神相全编',
    )
  }

  if (p.stanceWidth !== null) {
    const stBand = toBand(p.stanceWidth, T.stance)
    push(
      'body.posture.stance', '体态',
      p.stanceWidth >= T.stanceWide ? '双脚分开' : p.stanceWidth <= T.stanceNarrow ? '双脚并拢' : '站姿自然',
      stBand, round(p.stanceWidth), 'measured', conf('geometry'),
      `双踝间距为肩宽的 ${(p.stanceWidth * 100).toFixed(0)}%`,
      p.stanceWidth >= T.stanceWide
        ? '稳重踏实，安全感强'
        : p.stanceWidth <= T.stanceNarrow
          ? '自律优雅，举止收敛'
          : '站姿松弛得当',
      '冰鉴',
    )
  }

  /* ============ 肌肤气色 ============ */
  if (complexion && complexionFactor > 0) {
    const ruddy = complexion.aRel >= T.complexion.ruddy
    const pale = complexion.aRel <= T.complexion.pale
    const even = complexion.uniformity >= T.complexion.uniformGood
    push(
      'body.skin', '肌肤气色',
      ruddy && even ? '气色红润' : pale ? '气色偏淡' : even ? '气色平和' : '气色欠匀',
      ruddy && even ? 'high' : pale || !even ? 'low' : 'balanced',
      `相对红度 ${complexion.aRel}，均匀度 ${complexion.uniformity}`,
      'inferred', conf('complexion', complexionFactor),
      `颈部与手臂裸露区相对整体的红度 ${complexion.aRel > 0 ? '+' : ''}${complexion.aRel}，明度均匀度 ${complexion.uniformity}`,
      ruddy && even
        ? '气血调和，近期精神状态在线'
        : pale
          ? '肤色偏淡，宜注重休息与饮食均衡'
          : even
            ? '肤色平稳，作息大体规律'
            : '肤色欠匀，近期宜调整作息',
      '冰鉴',
    )
  } else {
    unavailable.push({
      id: 'body.skin', label: '肌肤气色', reason: 'low_confidence',
      detail: '裸露皮肤采样不足或画面存在明显色偏，本次不作气色判断',
    })
  }

  /* ============ 自评 ============ */
  if (survey?.voice) {
    push(
      'body.survey.voice', '自评', VOICE_LABEL[survey.voice], 'categorical', survey.voice,
      'self_reported', 0.7,
      `据你自述，声音特点为「${survey.voice}」`,
      VOICE_MEANING[survey.voice], '冰鉴',
    )
  }
  if (survey?.speechPace) {
    push(
      'body.survey.pace', '自评', `语速${survey.speechPace}`, 'categorical', survey.speechPace,
      'self_reported', 0.7,
      `据你自述，说话节奏「${survey.speechPace}」`,
      survey.speechPace === '偏快'
        ? '思维敏捷，反应迅速'
        : survey.speechPace === '偏慢'
          ? '思虑沉稳，谨慎行事'
          : '表达有节奏，收放自如',
      '冰鉴',
    )
  }
  if (survey?.dressStyle) {
    push(
      'body.survey.dress', '自评', survey.dressStyle, 'categorical', survey.dressStyle,
      'self_reported', 0.7,
      `据你自述，日常穿着偏向「${survey.dressStyle}」`,
      DRESS_MEANING[survey.dressStyle], '神相全编',
    )
  }

  /* ============ 不可观测 ============ */
  unavailable.push(
    { id: 'body.height', label: '身高体重', reason: 'out_of_scope',
      detail: '照片无法测出绝对身高体重；即使自述也仅用于体型换算，不作任何评价' },
    { id: 'body.sitWalk', label: '坐姿与走姿', reason: 'out_of_scope',
      detail: '单张静态照片拍不到动态举止' },
    { id: 'body.hair', label: '毛发', reason: 'out_of_scope',
      detail: '本版本未启用毛发分割' },
  )
  if (!m.hasLowerBody) {
    unavailable.push({
      id: 'body.posture.stance', label: '站姿重心', reason: 'not_captured',
      detail: '本次只拍到上半身，重心与站姿开合无法测量',
    })
  }

  const { features, unavailable: lowConf } = partitionByConfidence(drafts)

  const cautions: NonNullable<TixiangDerived['postureCautions']> = []
  if (p.shoulderRoll > T.posture.shoulderRoll) cautions.push('轻度圆肩')
  if (p.headForward > T.posture.headForward) cautions.push('头部前倾')
  if (p.shoulderSlope > T.posture.shoulderSlope) cautions.push('肩线不平')
  if (p.weightShift !== null && p.weightShift > T.posture.weightShift) cautions.push('重心偏移')
  if (p.stanceWidth !== null && p.stanceWidth <= T.stanceNarrow) cautions.push('站姿偏拘谨')

  const derived: TixiangDerived = {
    somatotype: { primary: soma.primary, scores: soma.scores },
    proportion: {
      upperLowerRatio: round(m.upperLowerRatio ?? 0),
      shoulderHipRatio: round(m.shoulderHipRatio),
      armReachLabel:
        m.armReach === null ? null : Math.abs(m.armReach) < 0.15 ? '垂至大腿中部' : m.armReach > 0 ? '偏长' : '偏短',
      neckLabel:
        m.neckRatio >= T.neck.hi ? '长颈' : m.neckRatio <= T.neck.lo ? '短颈' : '适中',
      label: describeProportion(m),
    },
    posture: {
      trunkTilt: round(p.trunkTilt, 1),
      shoulderSlope: round(p.shoulderSlope, 1),
      weightShift: p.weightShift === null ? null : round(p.weightShift),
      stanceWidth: p.stanceWidth === null ? null : round(p.stanceWidth),
      label: postureLabel,
    },
    postureCautions: cautions.slice(0, 4),
    capturedExtent: m.hasLowerBody ? 'full_body' : 'half_body',
    segmentationUsed: input.segmentationUsed,
    surveyAnswered: Boolean(survey && Object.values(survey).some(Boolean)),
    ...(survey ? { survey: { ...survey } } : {}),
  }

  return { features, unavailable: [...unavailable, ...lowConf], derived }
}

/* ============================================================ */

const SOMA_MEANING: Record<Somatotype, string> = {
  内胚型: '性情温和友善，情绪稳定，包容力强，节奏偏从容',
  中胚型: '行动力强，自信果断，勇于挑战，做事推得动',
  外胚型: '思维敏捷，感受细腻，重内在质地，长于深度钻研',
  平衡型: '刚柔并济，适应力强，各方面较为均衡',
  混合型: '兼具多型之长，可塑性强，能因场合调整',
}

const VOICE_LABEL: Record<string, string> = {
  洪亮: '声音洪亮', 柔和: '声音柔和', 低沉: '声音低沉', 清亮: '声音清亮',
}
const VOICE_MEANING: Record<string, string> = {
  洪亮: '自信外放，气场足，有感染力',
  柔和: '性情温和，善解人意，让人放松',
  低沉: '稳重踏实，说话有分量，令人信赖',
  清亮: '思路清晰，表达利落，反应快',
}
const DRESS_MEANING: Record<string, string> = {
  整洁得体: '自律性强，注重形象与分寸',
  随意自然: '随性自在，不拘小节',
  时尚前卫: '追求新意，适应力强，乐于尝试',
  传统保守: '稳重踏实，重视规矩与延续',
  朴素简约: '务实肯干，不慕虚荣',
}

function classifySomatotype(
  m: BodyMetrics,
  bmiValue: number | null,
): { primary: Somatotype; scores: { 内胚: number; 中胚: number; 外胚: number } } {
  const S = T.somatotype
  const hipShoulder = m.shoulderWidth > 1e-6 ? m.hipWidth / m.shoulderWidth : 0
  const shoulderTorso = m.torsoLen > 1e-6 ? m.shoulderWidth / m.torsoLen : 0
  const linearity = m.linearity ?? S.ectoLinearity

  const norm = (v: number, lo: number, hi: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)))

  let endo = norm(hipShoulder, 0.65, 0.9)
  let meso = norm(shoulderTorso, 0.5, 0.75)
  let ecto = norm(linearity, 2.9, 3.9)

  // BMI 可用时作为强先验加权
  if (bmiValue !== null) {
    endo = endo * 0.5 + norm(bmiValue, 20, 30) * 0.5
    meso = meso * 0.6 + norm(bmiValue, 19, 26) * 0.4
    ecto = ecto * 0.5 + (1 - norm(bmiValue, 17, 25)) * 0.5
  }

  const scores = { 内胚: +endo.toFixed(2), 中胚: +meso.toFixed(2), 外胚: +ecto.toFixed(2) }
  const entries = Object.entries(scores) as ['内胚' | '中胚' | '外胚', number][]
  entries.sort((a, b) => b[1] - a[1])
  const [top, , bottom] = entries

  if (top[1] - bottom[1] <= S.balanceTol) return { primary: '平衡型', scores }
  if (top[1] < S.minScore) return { primary: '混合型', scores }
  return { primary: `${top[0]}型` as Somatotype, scores }
}

function describeProportion(m: BodyMetrics): string {
  const parts: string[] = []
  if (m.shoulderHipRatio >= T.shoulderBroad) parts.push('肩背开阔')
  else if (m.shoulderHipRatio <= T.shoulderNarrow) parts.push('肩髋相称')
  if (m.upperLowerRatio !== null) {
    if (m.upperLowerRatio >= T.upperLong) parts.push('上身见长')
    else if (m.upperLowerRatio <= T.lowerLong) parts.push('下身见长')
    else parts.push('上下相称')
  }
  return parts.length ? parts.join('，') : '体格匀称'
}
