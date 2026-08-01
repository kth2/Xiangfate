/**
 * 骨相：度量 → FeatureItem。
 *
 * ⚠️ 本模块最重要的不是它算出了什么，而是它**明确说出算不出什么**。
 * 九骨中的枕骨、顶骨、耳后骨在任何照片里都不可见，
 * 龙骨、三台骨、反骨同理 —— 它们会被显式写进 unavailable，
 * 并由 System Prompt 硬性禁止 AI 发言。宁可少说，不可编造。
 *
 * 内容策略（docs/07）：
 * · 「骨贵肉贱」的价值排序已改为中性表述
 * · 颧骨「左高右低→易冲动」改为中性的行动倾向描述
 * · 枕骨扁平「晚年孤独」、骨多肉少「晚年孤苦」等消极预言已删
 * · 反骨「叛逆…可能反叛」、脑后见腮「心机重」等污名已改写
 * · 鸡胸、脊椎侧弯、驼背的人格评价已删，只保留体态提示
 */

import {
  computeConfidence,
  partitionByConfidence,
  round,
  toBand,
  type DraftFeature,
} from '@/core/band'
import type {
  Bone,
  Classic,
  FeatureCategory,
  GuxiangDerived,
  UnavailableItem,
} from '@/core/types'
import type { BoneMetrics } from './metrics'
import { T } from './thresholds'

export interface BoneRuleInput {
  m: BoneMetrics
  qualityFactor: number
  detectorScore: number
  hasProfile: boolean
  hasBody: boolean
}

export interface BoneRuleOutput {
  features: import('@/core/types').FeatureItem[]
  unavailable: UnavailableItem[]
  derived: GuxiangDerived
}

/** 任何照片都观测不到的骨 —— 这是本模块的硬边界 */
const UNOBSERVABLE: Bone[] = ['枕骨', '顶骨', '耳后骨']

export function applyBoneRules(input: BoneRuleInput): BoneRuleOutput {
  const { m, qualityFactor, detectorScore, hasProfile, hasBody } = input
  const drafts: DraftFeature[] = []
  const unavailable: UnavailableItem[] = []

  const conf = (method: Parameters<typeof computeConfidence>[2]) =>
    computeConfidence(qualityFactor, detectorScore, method)

  const push = (
    id: string, category: FeatureCategory, label: string, band: DraftFeature['band'],
    value: string | number, status: DraftFeature['status'], confidence: number,
    evidence: string, meaning: string, source: Classic | null,
  ) => drafts.push({ id, category, label, band, value, status, confidence, evidence, meaning, source })

  /* ============ 颧骨（权力骨）============ */
  const zpBand = toBand(m.zygoProminence, T.zygoProminence)
  push(
    'bone.zygomatic', '九骨',
    zpBand === 'high' || zpBand === 'very_high' ? '颧骨高耸' : zpBand === 'balanced' ? '颧骨端正' : '颧骨平和',
    zpBand, round(m.zygoProminence), 'inferred', conf('shading'),
    `颧点相对鼻根与太阳穴基准的深度突出量归一化后为 ${m.zygoProminence.toFixed(2)}，颧宽为 IOD 的 ${(m.zygoWidth * 100).toFixed(0)}%`,
    zpBand === 'high' || zpBand === 'very_high'
      ? '主见强，推动力与领导意愿突出'
      : zpBand === 'balanced'
        ? '性格平衡，处事稳重'
        : '配合度高，善于协作，不争一时之先',
    '太清神鉴',
  )

  push(
    'bone.zygomatic.flesh', '九骨',
    m.zygoEdge >= T.zygoEdgeSharp ? '骨露少肉' : m.zygoEdge <= T.zygoEdgeSoft ? '有肉包覆' : '骨肉匀停',
    m.zygoEdge >= T.zygoEdgeSharp ? 'high' : 'balanced',
    round(m.zygoEdge), 'inferred', conf('contour'),
    `颧至颌轮廓的灰度梯度强度归一化后为 ${m.zygoEdge.toFixed(2)}（越高轮廓越锐）`,
    m.zygoEdge >= T.zygoEdgeSharp
      ? '原则性强，界限分明，沟通时可多一分柔和'
      : m.zygoEdge <= T.zygoEdgeSoft
        ? '外柔内刚，善于协调，不锋芒毕露'
        : '刚柔有度，进退得宜',
    '太清神鉴',
  )

  if (m.zygoAsymmetry > T.zygoAsymTol) {
    push(
      'bone.zygomatic.asym', '九骨', '双颧微有高低', 'balanced', round(m.zygoAsymmetry, 3),
      'measured', conf('geometry'),
      `左右颧点高度差为 IOD 的 ${(m.zygoAsymmetry * 100).toFixed(1)}%`,
      '行动倾向偏主动，做决定时不太拖沓',
      '人伦大统赋',
    )
  } else {
    push(
      'bone.zygomatic.asym', '九骨', '双颧对称', 'high', round(m.zygoAsymmetry, 3),
      'measured', conf('geometry'),
      `左右颧点高度差仅为 IOD 的 ${(m.zygoAsymmetry * 100).toFixed(1)}%`,
      '性格平衡，处事稳重，情绪起伏小',
      '太清神鉴',
    )
  }

  /* ============ 额骨（智慧骨）============ */
  const frBand = toBand(m.foreheadRatio, T.foreheadRatio)
  const fhBand = toBand(m.foreheadHeight, T.foreheadHeight)
  const foreheadStrong = frBand === 'high' || frBand === 'very_high' || fhBand === 'high'
  push(
    'bone.frontal', '九骨',
    foreheadStrong ? '额骨宽阔饱满' : frBand === 'balanced' ? '额骨端正' : '额骨紧凑',
    foreheadStrong ? 'high' : frBand, round(m.foreheadRatio), 'measured', conf('geometry'),
    `额宽为颧宽的 ${(m.foreheadRatio * 100).toFixed(0)}%，额高为 IOD 的 ${(m.foreheadHeight * 100).toFixed(0)}%`,
    foreheadStrong
      ? '思维开阔，早年学习吸收力佳，善于统观'
      : frBand === 'balanced'
        ? '思路清晰，稳中求进'
        : '务实专注，长于深耕；可有意识地拓宽视角',
    '太清神鉴',
  )

  push(
    'bone.frontal.symmetry', '九骨',
    m.dayMoonAsym <= T.dayMoonTol ? '日月角对称' : '日月角略有高低',
    m.dayMoonAsym <= T.dayMoonTol ? 'high' : 'balanced', round(m.dayMoonAsym, 3),
    'measured', conf('geometry'),
    `左右额部高度差为 IOD 的 ${(m.dayMoonAsym * 100).toFixed(1)}%`,
    m.dayMoonAsym <= T.dayMoonTol ? '传统主家庭根基稳固，早年环境平顺' : '早年经历各有其势，自有一番磨练',
    '人伦大统赋',
  )

  /* ============ 下颌骨（意志骨）============ */
  const square = m.jawRatio >= T.jawSquare && m.gonialAngle <= T.gonialSquare
  const narrow = m.jawRatio <= T.jawNarrow
  const chinShape = m.chinRadius <= T.chinSharp ? '尖' : m.chinRadius >= T.chinRound ? '圆' : '方'
  push(
    'bone.mandible', '九骨',
    square ? '下颌宽大方正' : narrow ? '下颌清秀' : `${chinShape}下巴`,
    square ? 'high' : narrow ? 'low' : 'balanced',
    round(m.jawRatio), 'measured', conf('geometry'),
    `颌宽为颧宽的 ${(m.jawRatio * 100).toFixed(0)}%，下颌角 ${m.gonialAngle.toFixed(0)}°，下巴曲率半径 ${m.chinRadius.toFixed(2)}`,
    square
      ? '意志坚定，行动力强，认准的事能扛到底'
      : narrow
        ? '敏感细腻，审美佳；可有意识地增强一点耐受与坚持'
        : chinShape === '圆'
          ? '温和友善，善解人意'
          : '进退有据，柔中带刚',
    '太清神鉴',
  )

  /* ============ 颞骨 · 眉骨（弱推估）============ */
  const tempBand = toBand(m.templeRatio, T.templeRatio)
  push(
    'bone.temporal', '九骨',
    tempBand === 'high' || tempBand === 'very_high' ? '太阳穴饱满' : tempBand === 'balanced' ? '颞部平顺' : '太阳穴微陷',
    tempBand, round(m.templeRatio), 'inferred', conf('shading'),
    `太阳穴宽为颧宽的 ${(m.templeRatio * 100).toFixed(0)}%`,
    tempBand === 'high' || tempBand === 'very_high'
      ? '胆识过人，敢于尝试新路'
      : tempBand === 'balanced'
        ? '进取有度，稳中求变'
        : '谨慎保守，凡事先看清再动',
    '太清神鉴',
  )

  const brBand = toBand(m.browRidge, T.browRidge)
  push(
    'bone.brow', '九骨',
    brBand === 'high' || brBand === 'very_high' ? '眉骨高耸' : brBand === 'balanced' ? '眉骨平顺' : '眉骨柔和',
    brBand, round(m.browRidge), 'inferred', conf('shading'),
    `眉下至上睑的阴影梯度归一化后为 ${m.browRidge.toFixed(2)}`,
    brBand === 'high' || brBand === 'very_high'
      ? '性格有力度，对事情有掌控意愿'
      : '性情温和，不喜冲突，相处轻松',
    '人伦大统赋',
  )

  /* ============ 骨肉关系（本模块最可靠）============ */
  const bf = m.boneFleshRatio
  const bfLabel: GuxiangDerived['boneFleshLabel'] =
    bf >= T.boneFlesh.boneHeavy ? '骨多肉少' : bf <= T.boneFlesh.fleshHeavy ? '骨少肉多' : '骨肉相称'
  push(
    'bone.boneFlesh', '骨肉', bfLabel,
    bfLabel === '骨肉相称' ? 'balanced' : bfLabel === '骨多肉少' ? 'high' : 'low',
    round(bf), 'inferred', conf('contour'),
    `骨感指标（颧宽、颌宽、颌角方正度）与肉感指标（轮廓平滑度、下巴圆润度、颌颧比）综合后，骨占比 ${(bf * 100).toFixed(0)}%`,
    bfLabel === '骨肉相称'
      ? '刚柔并济，平衡发展 —— 传统骨相视此为最佳状态'
      : bfLabel === '骨多肉少'
        ? '刚毅坚强，原则性高；多一分包容与柔和会更从容'
        : '温和友善，人缘佳；在需要决断的场合可以更果决一些',
    '太清神鉴',
  )

  /* ============ 头型（需侧面照）============ */
  let headShape: GuxiangDerived['headShape']
  if (m.cephalicIndex !== null) {
    const ci = m.cephalicIndex
    const value =
      ci < T.cephalic.long ? '长头型' : ci < T.cephalic.round ? '圆头型' : ci < T.cephalic.flat ? '方头型' : '扁头型'
    headShape = { value, cephalicIndex: ci, status: 'inferred' }
    push(
      'bone.headShape', '头型', value, 'categorical', value, 'inferred', conf('cephalic'),
      `由正面照的头宽与侧面照的头部前后径估算，颅指数约 ${ci.toFixed(2)}`,
      HEAD_MEANING[value], '太清神鉴',
    )
  } else {
    headShape = { value: null, cephalicIndex: null, status: 'not_captured' }
    unavailable.push({
      id: 'bone.headShape', label: '头型', reason: 'not_captured',
      detail: '头型要看头部的前后径与左右径之比，缺少侧面照就判定不了',
    })
  }

  /* ============ 骨骼粗细 ============ */
  let thickness: GuxiangDerived['boneThickness']
  if (m.body) {
    thickness =
      m.body.wristRatio >= T.body.wristThick
        ? '粗骨型'
        : m.body.wristRatio <= T.body.wristThin
          ? '细骨型'
          : '中骨型'
    push(
      'bone.thickness', '骨骼粗细', thickness, 'categorical', thickness, 'inferred', conf('contour'),
      `腕部宽度为前臂长的 ${(m.body.wristRatio * 100).toFixed(0)}%`,
      THICK_MEANING[thickness], '人伦大统赋',
    )
  } else {
    // 无体照时从面部骨感反推，可靠度更低
    thickness = bf >= T.boneFlesh.boneHeavy ? '粗骨型' : bf <= T.boneFlesh.fleshHeavy ? '细骨型' : '中骨型'
    push(
      'bone.thickness', '骨骼粗细', thickness, 'categorical', thickness, 'inferred', conf('shading'),
      `无体照，由面部骨肉比 ${(bf * 100).toFixed(0)}% 与下颌角 ${m.gonialAngle.toFixed(0)}° 间接推估`,
      THICK_MEANING[thickness], '人伦大统赋',
    )
  }

  /* ============ 体骨（需体照）============ */
  if (m.body) {
    const b = m.body
    push(
      'bone.shoulder', '体骨',
      b.shoulderRatio >= T.body.shoulderBroad ? '肩骨宽厚' : b.shoulderRatio <= T.body.shoulderNarrow ? '肩骨清秀' : '肩骨端正',
      b.shoulderRatio >= T.body.shoulderBroad ? 'high' : b.shoulderRatio <= T.body.shoulderNarrow ? 'low' : 'balanced',
      round(b.shoulderRatio), 'measured', conf('geometry'),
      `肩宽为躯干长的 ${(b.shoulderRatio * 100).toFixed(0)}%，肩线倾角 ${b.shoulderSlope.toFixed(1)}°`,
      b.shoulderRatio >= T.body.shoulderBroad
        ? '格局大，能担当重任'
        : b.shoulderRatio <= T.body.shoulderNarrow
          ? '轻装上阵，灵活机动'
          : '担当与灵活兼顾',
      '人伦大统赋',
    )
    push(
      'bone.spine', '体骨',
      b.spineTilt <= T.body.spineUpright ? '背脊挺直' : '背脊微倾',
      b.spineTilt <= T.body.spineUpright ? 'high' : 'balanced',
      round(b.spineTilt, 1), 'measured', conf('geometry'),
      `躯干轴与铅垂线夹角 ${b.spineTilt.toFixed(1)}°`,
      b.spineTilt <= T.body.spineUpright
        ? '正直刚毅，有原则，气象端正'
        : '体态自有其势；日常可留意久坐时的姿势',
      '太清神鉴',
    )
    push(
      'bone.pelvis', '体骨',
      b.pelvisRatio >= T.body.pelvisWide ? '骨盆宽厚' : b.pelvisRatio <= T.body.pelvisNarrow ? '骨盆清窄' : '骨盆端正',
      b.pelvisRatio >= T.body.pelvisWide ? 'high' : b.pelvisRatio <= T.body.pelvisNarrow ? 'low' : 'balanced',
      round(b.pelvisRatio), 'measured', conf('geometry'),
      `髋宽为肩宽的 ${(b.pelvisRatio * 100).toFixed(0)}%`,
      b.pelvisRatio >= T.body.pelvisWide ? '包容力强，根基稳' : '身形利落，行动轻捷',
      '人伦大统赋',
    )
  } else {
    unavailable.push({
      id: 'bone.body', label: '肩骨 · 脊椎 · 骨盆', reason: 'not_captured',
      detail: '本次没有采集体照，体骨部分无法测量',
    })
  }

  /* ============ 硬边界：不可观测的骨 ============ */
  for (const bone of UNOBSERVABLE) {
    unavailable.push({
      id: `bone.nineBones.${bone}`, label: bone, reason: 'not_observable',
      detail:
        bone === '枕骨'
          ? '枕骨位于后脑，正面与侧面照均无法观测，且常被头发遮挡'
          : bone === '顶骨'
            ? '顶骨位于头顶，照片拍不到，且面部网格不覆盖颅顶'
            : '耳后骨需实际触诊，照片无法观测',
    })
  }
  unavailable.push({
    id: 'bone.special', label: '龙骨 · 三台骨 · 反骨', reason: 'not_observable',
    detail: '这几种特殊骨相都依赖颅顶与后脑的形态，任何照片都观测不到',
  })

  const { features, unavailable: lowConf } = partitionByConfidence(drafts)

  const observable: Bone[] = ['颧骨', '额骨', '下颌骨']
  const inferredBones: Bone[] = ['颞骨', '眉骨']
  if (hasProfile) observable.push('鼻骨')

  const specialForms: NonNullable<GuxiangDerived['specialForms']> = []
  // 虎骨：头宽 + 颧高，可从正面照近似判定
  if (m.foreheadRatio >= T.foreheadRatio.hi && m.zygoProminence >= T.zygoProminence.hi) {
    specialForms.push('虎骨')
  }
  // 脑后见腮：腮宽接近甚至超过颧宽
  if (m.jawRatio >= T.jawRatio.veryHi) specialForms.push('脑后见腮')

  const derived: GuxiangDerived = {
    headShape,
    boneFleshRatio: round(bf),
    boneFleshLabel: bfLabel,
    boneThickness: thickness,
    observableBones: observable,
    inferredBones,
    unobservableBones: UNOBSERVABLE,
    specialForms,
    bodyBonesCaptured: hasBody,
  }

  return { features, unavailable: [...unavailable, ...lowConf], derived }
}

const HEAD_MEANING: Record<string, string> = {
  圆头型: '外向开朗，善于交际，适应力强',
  长头型: '内敛深沉，善于思考，专注力佳',
  方头型: '稳重务实，逻辑清晰，执行可靠',
  扁头型: '踏实肯干，不冒进，重视稳妥',
}

const THICK_MEANING: Record<string, string> = {
  粗骨型: '体力充沛，性格直率，行动力与执行力见长',
  细骨型: '敏感细腻，情感丰富，长于思考与创作',
  中骨型: '文武兼备，刚柔并济，适应面广',
}
