/**
 * 手相：度量 → FeatureItem。
 *
 * 内容策略（docs/07）：
 * · 「七、手相看健康」整节已删 —— 掌色发黄→肝胆、纵纹→消化系统全是伪医学
 * · 生命线短浅**绝不**与寿命关联，只写作息养护
 * · 水星丘过盛「狡诈不诚实」、金星丘过盛「纵欲」、月丘过盛「脱离现实」已改写
 * · 婚姻线不谈婚姻次数与时间，只谈情感风格倾向
 * · 干湿手、软硬手、指甲半月纹标 out_of_scope（照片测不到）
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
  HandType,
  LineDetection,
  MountBand,
  MountName,
  PalmLineName,
  ShouxiangDerived,
  UnavailableItem,
} from '@/core/types'
import type { MountKey } from './landmarks'
import type { HandMetrics } from './metrics'
import { MOUNT_MEANING } from './mounts'
import type { LineMeasure } from './palmlines'
import { T } from './thresholds'

export interface HandRuleInput {
  m: HandMetrics
  lines: Map<PalmLineName, LineMeasure>
  mounts: Record<MountKey, { fullness: number; band: Exclude<MountBand, 'unavailable'> }>
  qualityFactor: number
  detectorScore: number
  handedness: 'Left' | 'Right'
  dominantHand: 'left' | 'right' | null
  /** 双手都采集时，另一只手的综合分 */
  otherHandScore?: number | null
  handsCaptured: ('left' | 'right')[]
}

export interface HandRuleOutput {
  features: import('@/core/types').FeatureItem[]
  unavailable: UnavailableItem[]
  derived: ShouxiangDerived
  /** 本手的综合分，供左右手对照 */
  overallScore: number
}

const ALL_LINES: PalmLineName[] = ['生命线', '智慧线', '感情线', '命运线', '太阳线', '婚姻线']

export function applyHandRules(input: HandRuleInput): HandRuleOutput {
  const { m, lines, mounts, qualityFactor, detectorScore } = input
  const drafts: DraftFeature[] = []
  const unavailable: UnavailableItem[] = []

  const conf = (method: Parameters<typeof computeConfidence>[2], q = qualityFactor) =>
    computeConfidence(q, detectorScore, method)

  const push = (
    id: string, category: FeatureCategory, label: string, band: DraftFeature['band'],
    value: string | number, status: DraftFeature['status'], confidence: number,
    evidence: string, meaning: string, source: Classic | null,
  ) => drafts.push({ id, category, label, band, value, status, confidence, evidence, meaning, source })

  /* ============ 手型 ============ */
  const ht = classifyHandType(m)
  push(
    'hand.type', '手型', ht.primary, 'categorical', ht.primary, 'measured', conf('geometry'),
    `掌宽掌长比 ${m.palmAspect.toFixed(2)}，中指与掌长比 ${m.fingerPalmRatio.toFixed(2)}，指节突出度 ${m.knuckleProminence.toFixed(2)}`,
    HAND_TYPE_MEANING[ht.primary], HAND_TYPE_SOURCE[ht.primary],
  )

  /* ============ 指形 ============ */
  const thumbBand = toBand(m.thumbRatio, T.thumb)
  push(
    'hand.finger.thumb', '指形',
    m.thumbRatio >= T.thumbStrong ? '拇指长而有力' : m.thumbRatio <= T.thumbShort ? '拇指秀短' : '拇指端正',
    thumbBand, round(m.thumbRatio), 'measured', conf('geometry'),
    `拇指长为掌长的 ${(m.thumbRatio * 100).toFixed(0)}%`,
    m.thumbRatio >= T.thumbStrong
      ? '意志力强，主意正，推得动事'
      : m.thumbRatio <= T.thumbShort
        ? '随和易协作；需要拿主意时可以更果断一些'
        : '进退有度，能柔能刚',
    '神相全编',
  )

  const irBand = toBand(m.indexRingRatio, T.indexRing)
  push(
    'hand.finger.index', '指形',
    m.indexRingRatio >= T.indexLong ? '食指长' : m.indexRingRatio <= T.ringLong ? '无名指长' : '二指相当',
    irBand, round(m.indexRingRatio), 'measured', conf('geometry'),
    `食指长为无名指的 ${m.indexRingRatio.toFixed(2)} 倍`,
    m.indexRingRatio >= T.indexLong
      ? '有主导意愿，愿意扛事、带头'
      : m.indexRingRatio <= T.ringLong
        ? '审美与艺术感受力佳，重表达'
        : '进取与审美并重',
    '水镜神相',
  )

  push(
    'hand.finger.little', '指形', m.pinkyLong ? '小指长' : '小指短',
    m.pinkyLong ? 'high' : 'low', m.pinkyLong ? '过无名指第一指节' : '未过无名指第一指节',
    'measured', conf('geometry'),
    `以小指尖是否超过无名指第一指节判定：${m.pinkyLong ? '已超过' : '未超过'}`,
    m.pinkyLong ? '沟通表达力佳，善于把话说到点上' : '内敛务实；表达上可以更主动些',
    '神相全编',
  )

  /* ============ 掌线 ============ */
  for (const name of ALL_LINES) {
    const L = lines.get(name)
    if (!L) {
      // 「该线不显」在相学上本身有含义，但绝不能假装测到了
      if (name === '命运线') {
        push(
          'hand.line.fate.absent', '掌线', '命运线不显', 'categorical', '未检出',
          'measured', conf('palmline', qualityFactor * 0.8),
          '本次未检出清晰的命运线',
          '传统主不拘固定轨道，人生路径由自己一步步走出来',
          '神相全编',
        )
      }
      unavailable.push({
        id: `hand.line.${LINE_ID[name]}`, label: name, reason: 'low_confidence',
        detail: `本次未能在标准掌面上稳定识别出${name}；光线柔和一些重拍，或在校正界面手动指认`,
      })
      continue
    }
    emitLine(name, L, push, conf)
  }

  /* ============ 掌丘 ============ */
  for (const key of Object.keys(mounts) as MountKey[]) {
    const mt = mounts[key]
    const meaning = MOUNT_MEANING[key]
    const text =
      mt.band === 'very_high' ? meaning.excess : mt.band === 'high' ? meaning.high :
      mt.band === 'balanced' ? '发展均衡，无明显偏倚' : meaning.low
    push(
      `hand.mount.${MOUNT_ID[key]}`, '掌丘',
      mt.band === 'high' || mt.band === 'very_high' ? `${key}丰满` : mt.band === 'balanced' ? `${key}适中` : `${key}平坦`,
      mt.band, round(mt.fullness), 'inferred', conf('mount'),
      `${key}区域相对掌面的亮度偏移换算后为 ${mt.fullness.toFixed(2)}`,
      text, '水镜神相',
    )
  }

  /* ============ 不可观测 ============ */
  unavailable.push(
    { id: 'hand.moisture', label: '干手湿手', reason: 'out_of_scope',
      detail: '手部干湿需要触觉，照片判断不了' },
    { id: 'hand.firmness', label: '软手硬手', reason: 'out_of_scope',
      detail: '手掌软硬需要触觉，照片判断不了' },
    { id: 'hand.nail', label: '指甲半月纹与纵横纹', reason: 'out_of_scope',
      detail: '手机摄像头的分辨率与对焦不足以稳定分辨指甲纹路' },
  )
  if (input.handsCaptured.length < 2) {
    unavailable.push({
      id: 'hand.comparison', label: '左右手对照', reason: 'not_captured',
      detail: '本次只采集了一只手，先天与后天的对照暂缺',
    })
  }

  const { features, unavailable: lowConf } = partitionByConfidence(drafts)

  /* ============ derived ============ */
  const lineDetection = {} as ShouxiangDerived['lineDetection']
  for (const name of ALL_LINES) {
    const L = lines.get(name)
    const d: LineDetection = L
      ? { detected: true, matchScore: L.matchScore, corrected: L.corrected }
      : { detected: false, matchScore: 0, corrected: false }
    ;(lineDetection as Record<string, LineDetection>)[name] = d
  }

  const mountProfile = {} as Record<MountName, MountBand>
  for (const key of Object.keys(mounts) as MountKey[]) {
    mountProfile[key as MountName] = mounts[key].band
  }

  const overallScore = scoreHand(lines)
  let comparison: ShouxiangDerived['leftRightComparison'] = null
  if (input.otherHandScore != null && input.handsCaptured.length === 2) {
    const diff = overallScore - input.otherHandScore
    const thisIsRight = input.handedness === 'Right'
    if (Math.abs(diff) <= T.handDiff) comparison = '左右相似'
    else if (diff > 0) comparison = thisIsRight ? '右优于左' : '左优于右'
    else comparison = thisIsRight ? '左优于右' : '右优于左'
  }

  const derived: ShouxiangDerived = {
    handType: {
      primary: ht.primary,
      score: round(ht.score),
      secondary: ht.secondary,
      secondaryScore: ht.secondaryScore === null ? null : round(ht.secondaryScore),
    },
    dominantHand: input.dominantHand,
    handsCaptured: input.handsCaptured,
    lineDetection,
    leftRightComparison: comparison,
    mountProfile,
  }

  return { features, unavailable: [...unavailable, ...lowConf], derived, overallScore }
}

/* ============================================================ */

const LINE_ID: Record<PalmLineName, string> = {
  生命线: 'life', 智慧线: 'head', 感情线: 'heart',
  命运线: 'fate', 太阳线: 'sun', 婚姻线: 'marriage',
}

const MOUNT_ID: Record<MountKey, string> = {
  木星丘: 'jupiter', 土星丘: 'saturn', 太阳丘: 'apollo', 水星丘: 'mercury',
  金星丘: 'venus', 月丘: 'moon', 火星丘: 'mars',
}

type PushFn = (
  id: string, category: FeatureCategory, label: string, band: DraftFeature['band'],
  value: string | number, status: DraftFeature['status'], confidence: number,
  evidence: string, meaning: string, source: Classic | null,
) => void

function emitLine(
  name: PalmLineName,
  L: LineMeasure,
  push: PushFn,
  conf: (m: Parameters<typeof computeConfidence>[2], q?: number) => number,
) {
  const id = `hand.line.${LINE_ID[name]}`
  // 置信度直接跟匹配分挂钩：勉强匹配上的线不该被当成实测
  const c = conf('palmline') * (L.corrected ? 0.85 : Math.min(1, L.matchScore / 0.7))
  const status: DraftFeature['status'] = L.corrected ? 'self_reported' : 'measured'
  const ev = `长度为掌宽的 ${L.lengthRatio.toFixed(2)} 倍，深浅 ${L.depth.toFixed(2)}，连续性 ${L.continuity.toFixed(2)}，曲率 ${L.curvature.toFixed(3)}${L.corrected ? '（经你本人确认）' : ''}`
  const LT = T.line

  switch (name) {
    case '生命线': {
      const deepLong = L.lengthRatio >= LT.lifeLong && L.depth >= LT.deep
      const short = L.lengthRatio <= LT.lifeShort || L.depth <= LT.shallow
      push(
        id, '掌线',
        L.doubled ? '双生命线' : deepLong ? '生命线深长清晰' : short ? '生命线浅短' : '生命线端正',
        deepLong ? 'high' : short ? 'low' : 'balanced', L.lengthRatio, status, c, ev,
        L.doubled
          ? '恢复力强，韧性佳'
          : deepLong
            ? '体质根基好，活力充沛'
            : short
              ? '精力有起伏，宜规律作息、注重养护'
              : '精力平稳，张弛有度',
        '神相全编',
      )
      if (L.continuity <= LT.broken) {
        push(
          `${id}.continuity`, '掌线', '生命线断续', 'low', L.continuity, status, c * 0.9,
          `沿线检出断口，连续性 ${L.continuity.toFixed(2)}`,
          '精力有阶段性起伏，宜留意节奏，别长期硬撑',
          '水镜神相',
        )
      }
      break
    }
    case '智慧线': {
      const long = L.lengthRatio >= LT.headLong
      const straight = L.curvature <= LT.straight
      push(
        id, '掌线',
        long && straight ? '智慧线长而直' : long ? '智慧线长而弯' : '智慧线简短',
        long ? 'high' : 'low', L.lengthRatio, status, c, ev,
        long && straight
          ? '逻辑思维强，理性分析见长'
          : long
            ? '直觉敏锐，富有创造力'
            : '务实主义，重执行，不绕弯子',
        '神相全编',
      )
      if (L.branches >= 1) {
        push(
          `${id}.branch`, '掌线', '智慧线末端分叉', 'high', L.branches, status, c * 0.9,
          `检出 ${L.branches} 处分叉`,
          '多才多艺，能一专多能',
          '水镜神相',
        )
      }
      break
    }
    case '感情线': {
      const rising = L.endRising && L.curvature >= LT.curved
      const flat = L.lengthRatio >= LT.heartLong && L.curvature <= LT.straight
      push(
        id, '掌线',
        rising ? '感情线上扬' : flat ? '感情线长而平直' : L.endRising ? '感情线舒展' : '感情线下垂',
        rising || flat ? 'high' : 'balanced', L.lengthRatio, status, c, ev,
        rising
          ? '热情开朗，感情上主动表达'
          : flat
            ? '情感稳定，重承诺，一旦认定就长久'
            : L.endRising
              ? '感情表达自然，收放有度'
              : '敏感重情，心思细腻，宜多与人沟通',
        '神相全编',
      )
      if (L.branches >= 2) {
        push(
          `${id}.branch`, '掌线', '感情线多支分叉', 'balanced', L.branches, status, c * 0.9,
          `检出 ${L.branches} 处分叉`,
          '情感丰富，人际面广，与不同的人都能连上',
          '水镜神相',
        )
      }
      break
    }
    case '命运线': {
      const solid = L.depth >= LT.deep && L.continuity >= 0.85
      push(
        id, '掌线',
        solid ? '命运线深长直' : L.continuity <= LT.broken ? '命运线断续' : '命运线端正',
        solid ? 'high' : L.continuity <= LT.broken ? 'low' : 'balanced',
        L.lengthRatio, status, c, ev,
        solid
          ? '事业方向清晰，走得稳'
          : L.continuity <= LT.broken
            ? '事业多阶段转折，适合灵活调整而非死守一条路'
            : '事业推进平稳，节奏自持',
        '神相全编',
      )
      break
    }
    case '太阳线': {
      push(
        id, '掌线', L.depth >= 0.5 ? '太阳线清晰' : '太阳线浅淡',
        L.depth >= 0.5 ? 'high' : 'balanced', L.depth, status, c, ev,
        L.depth >= 0.5 ? '才华容易被看见，做出来的东西有辨识度' : '低调务实，成果靠积累说话',
        '水镜神相',
      )
      break
    }
    case '婚姻线': {
      push(
        id, '掌线', L.endRising ? '婚姻线上扬' : '婚姻线平直',
        'categorical', L.lengthRatio, status, c, ev,
        L.endRising ? '对亲密关系的期待偏积极，重经营' : '感情观稳定专一，重实际相处',
        '神相全编',
      )
      break
    }
  }
}

const HAND_TYPE_MEANING: Record<HandType, string> = {
  原始手: '行动力强，朴实稳重，执行力佳，做事从手上见真章',
  方形手: '逻辑强，做事有计划，守规矩 —— 适合管理、财务、法律、工程一类的做事方式',
  圆形手: '情感丰富，善于交际，直觉敏锐 —— 适合服务、教育、创意一类的做事方式',
  锥形手: '创造力强，追求完美，想象力丰富 —— 适合设计、创作、策划一类的做事方式',
  精神手: '善于思考，重精神层面，喜抽象理论 —— 适合研究、教学一类的做事方式',
}

const HAND_TYPE_SOURCE: Record<HandType, Classic> = {
  原始手: '神相全编', 方形手: '水镜神相', 圆形手: '水镜神相',
  锥形手: '神相全编', 精神手: '神相全编',
}

function classifyHandType(m: HandMetrics): {
  primary: HandType
  score: number
  secondary: HandType | null
  secondaryScore: number | null
} {
  const H = T.handType
  const s = (b: boolean, w = 1) => (b ? w : 0)

  const scores: Record<HandType, number> = {
    原始手: (s(m.palmAspect >= H.squarePalm) + s(m.fingerPalmRatio <= H.shortFinger)) / 2,
    方形手:
      (s(m.palmAspect >= H.narrowPalm && m.palmAspect <= H.squarePalm + 0.06) +
        s(m.fingerPalmRatio > H.shortFinger && m.fingerPalmRatio < H.longFinger)) / 2,
    圆形手:
      (s(m.palmAspect >= H.squarePalm - 0.02) + s(m.knuckleProminence < H.knuckleHigh * 0.7)) / 2,
    锥形手:
      (s(m.palmAspect <= H.narrowPalm) + s(m.fingerPalmRatio >= H.longFinger)) / 2,
    精神手:
      (s(m.palmAspect <= H.narrowPalm) * 0.8 +
        s(m.fingerPalmRatio >= H.longFinger) * 0.8 +
        s(m.knuckleProminence >= H.knuckleHigh) * 1.4) / 3,
  }

  const ranked = (Object.entries(scores) as [HandType, number][]).sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  return {
    primary: top[1] > 0 ? top[0] : '方形手',
    score: top[1],
    secondary: second[1] > 0.3 ? second[0] : null,
    secondaryScore: second[1] > 0.3 ? second[1] : null,
  }
}

/** 主线综合分，仅用于左右手对照 */
function scoreHand(lines: Map<PalmLineName, LineMeasure>): number {
  const main: PalmLineName[] = ['生命线', '智慧线', '感情线', '命运线']
  let sum = 0
  for (const n of main) {
    const L = lines.get(n)
    if (!L) continue
    sum += (Math.min(1.2, L.lengthRatio) / 1.2) * 0.4 + L.depth * 0.3 + L.continuity * 0.3
  }
  return +(sum / main.length).toFixed(3)
}
