/**
 * 面相：度量 → FeatureItem。
 *
 * 这里是「数值先行，术语其次」原则的落点：先有可复现的几何数值，
 * 再映射到传统术语，evidence 里必须带上具体数字。
 *
 * ⚠️ meaning 文案按 docs/07 的硬边界写：不含寿夭断言、疾病指向、性别刻板、身材贬损。
 * 除此之外**照相书原意写**——忌相就是忌相，六亲缘薄就是六亲缘薄，不作好听的改写。
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
  FaceShape,
  FeatureCategory,
  FiveElement,
  MianxiangDerived,
  Palace,
  UnavailableItem,
} from '@/core/types'
import type { ComplexionResult } from '@/core/color'
import type { FaceMetrics, Side } from './metrics'
import { T } from './thresholds'

export interface RuleInput {
  m: FaceMetrics
  qualityFactor: number
  complexionFactor: number
  detectorScore: number
  complexion: ComplexionResult | null
  /** 眉毛像素度量，无图像时为 null */
  browPixels: Record<Side, { density: number; tailDispersion: number }> | null
  /** 额头是否被头发遮挡 —— 影响上停可信度 */
  foreheadOccluded: boolean
}

export interface RuleOutput {
  features: import('@/core/types').FeatureItem[]
  unavailable: UnavailableItem[]
  derived: MianxiangDerived
}

/** 两侧取均值，减少单侧噪声 */
const bilateral = (l: number, r: number) => (l + r) / 2

export function applyFaceRules(input: RuleInput): RuleOutput {
  const { m, qualityFactor, complexionFactor, detectorScore, complexion, browPixels } = input
  const drafts: DraftFeature[] = []
  const unavailable: UnavailableItem[] = []

  const conf = (method: Parameters<typeof computeConfidence>[2], q = qualityFactor) =>
    computeConfidence(q, detectorScore, method)

  const push = (
    id: string,
    category: FeatureCategory,
    label: string,
    band: DraftFeature['band'],
    value: string | number,
    status: DraftFeature['status'],
    confidence: number,
    evidence: string,
    meaning: string,
    source: Classic | null,
  ) => drafts.push({ id, category, label, band, value, status, confidence, evidence, meaning, source })

  /* ============ 三停 ============ */
  const c = m.threeCourts
  // 发际线取自网格顶端，本就不准；被头发遮挡时进一步下调
  const courtConf = conf('meshHairline', input.foreheadOccluded ? qualityFactor * 0.8 : qualityFactor)
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const courtsStr = `${pct(c.upper)} : ${pct(c.middle)} : ${pct(c.lower)}`

  if (c.maxDiff <= T.courtBalanceTol) {
    push(
      'face.threeCourts.balance', '三停', '三停平均', 'balanced', courtsStr, 'measured', courtConf,
      `上停 ${pct(c.upper)}，中停 ${pct(c.middle)}，下停 ${pct(c.lower)}，两两差值均不超过 ${pct(T.courtBalanceTol)}`,
      '一生运势平稳，各阶段无显著起落', '麻衣神相',
    )
  } else {
    const dominant = (['upper', 'middle', 'lower'] as const).reduce((a, b) => (c[a] >= c[b] ? a : b))
    const CFG = {
      upper: { label: '天庭饱满', meaning: '早年得势，偏思虑型，学习与规划见长', src: '麻衣神相' as Classic },
      middle: { label: '中停丰隆', meaning: '中年主运，意志与执行力居优', src: '神相全编' as Classic },
      lower: { label: '地阁方圆', meaning: '晚运厚实，重根基与长期积累', src: '麻衣神相' as Classic },
    }
    const cfg = CFG[dominant]
    push(
      `face.threeCourts.${dominant}`, '三停', cfg.label, 'high', courtsStr, 'measured', courtConf,
      `${dominant === 'upper' ? '上' : dominant === 'middle' ? '中' : '下'}停占 ${pct(c[dominant])}，为三停之最（三停 ${courtsStr}）`,
      cfg.meaning, cfg.src,
    )
    const weakest = (['upper', 'middle', 'lower'] as const).reduce((a, b) => (c[a] <= c[b] ? a : b))
    if (c[weakest] <= T.court.lo) {
      const WCFG = {
        upper: { label: '上停偏窄', meaning: '传统主早年少荫庇，祖业父荫薄，须自立门户' },
        middle: { label: '中停平和', meaning: '传统主中年运势平平，进取之力稍逊，宜借外缘' },
        lower: { label: '下停偏窄', meaning: '传统主晚运偏薄，根基不厚，须早作积蓄' },
      }
      push(
        `face.threeCourts.${weakest}Weak`, '三停', WCFG[weakest].label, 'low', pct(c[weakest]),
        'measured', courtConf,
        `${weakest === 'upper' ? '上' : weakest === 'middle' ? '中' : '下'}停仅占 ${pct(c[weakest])}，低于均衡线 ${pct(T.court.lo)}`,
        WCFG[weakest].meaning, '柳庄相法',
      )
    }
  }

  /* ============ 五眼 ============ */
  const fiveBand = toBand(m.fiveEye, T.fiveEye)
  push(
    'face.fiveEye', '五眼',
    fiveBand === 'balanced' ? '五眼匀称' : fiveBand === 'high' || fiveBand === 'very_high' ? '面阔眼秀' : '眼大面秀',
    fiveBand, round(m.fiveEye), 'measured', conf('geometry'),
    `脸宽为单眼宽的 ${m.fiveEye.toFixed(2)} 倍（传统「五眼」以 5.0 为匀称）`,
    fiveBand === 'balanced'
      ? '五官格局端正，与人相处顺畅'
      : fiveBand === 'high' || fiveBand === 'very_high'
        ? '格局开阔，长于统观全局；然失于粗疏，细处不耐烦'
        : '面窄眼大，传统主气量偏局促、易为小事所困，然感受敏锐',
    '麻衣神相',
  )

  const gapBand = toBand(m.innerGap, T.innerGap)
  push(
    'face.innerGap', '五眼',
    gapBand === 'balanced' ? '两眼间距适中' : gapBand === 'low' || gapBand === 'very_low' ? '眼距紧凑' : '眼距开阔',
    gapBand, round(m.innerGap), 'measured', conf('geometry'),
    `两内眼角间距为单眼宽的 ${m.innerGap.toFixed(2)} 倍（1.0 为标准）`,
    gapBand === 'balanced'
      ? '心胸开阔，不计较小节'
      : gapBand === 'low' || gapBand === 'very_low'
        ? '传统主心量偏窄、易执着于眼前，心事不易放下'
        : '传统主心大而疏，思路发散，收束之力不足',
    '神相全编',
  )

  /* ============ 眉 ============ */
  const browLen = bilateral(m.brow.left.lenRatio, m.brow.right.lenRatio)
  const browLenBand = toBand(browLen, T.browLen)
  push(
    'face.brow.length', '眉',
    browLen >= T.browOverEye ? '眉长过目' : browLenBand === 'balanced' ? '眉与目齐' : '眉短于目',
    browLenBand, round(browLen), 'measured', conf('geometry'),
    `眉长为同侧眼长的 ${browLen.toFixed(2)} 倍（「眉长过目」的传统判线为 ${T.browOverEye}）`,
    browLen >= T.browOverEye
      ? '传统主兄弟朋友情深、助力较多'
      : browLenBand === 'balanced'
        ? '人际关系平衡，亲疏有度'
        : '传统主兄弟缘薄、六亲助力少，凡事多靠自己',
    '麻衣神相',
  )

  // 眉形分类
  const curve = bilateral(m.brow.left.curvature, m.brow.right.curvature)
  const tilt = bilateral(m.brow.left.tilt, m.brow.right.tilt)
  const browShape = classifyBrow(curve, tilt)
  push(
    'face.brow.shape', '眉', browShape.label, 'categorical', browShape.label, 'measured', conf('geometry'),
    `眉弯曲度 ${curve.toFixed(3)}（矢高÷弦长），眉尾相对眉头倾角 ${tilt.toFixed(1)}°`,
    browShape.meaning, browShape.source,
  )

  // 印堂宽（命宫）
  const browGap = m.brow.left.gapRatio
  const gapB = toBand(browGap, T.browGap)
  push(
    'face.palace.mingGong', '十二宫',
    browGap < T.browGapNarrow ? '印堂偏窄' : gapB === 'balanced' ? '印堂宽广' : '印堂开阔',
    gapB, round(browGap), 'measured', conf('geometry'),
    `两眉头间距为单眼宽的 ${browGap.toFixed(2)} 倍`,
    browGap < T.browGapNarrow
      ? '传统主心量狭窄、多思多虑，遇事易钻牛角尖，运途多滞'
      : '心胸开阔，遇事不易钻牛角尖',
    '麻衣神相',
  )

  // 眉毛浓密（像素推导）
  if (browPixels) {
    const density = bilateral(browPixels.left.density, browPixels.right.density)
    const dBand = toBand(density, T.browDensity)
    push(
      'face.brow.density', '眉',
      dBand === 'high' || dBand === 'very_high' ? '眉毛浓密' : dBand === 'balanced' ? '眉浓淡适中' : '眉毛疏朗',
      dBand, round(density), 'inferred', conf('density'),
      `眉部区域暗像素占比 ${(density * 100).toFixed(0)}%`,
      dBand === 'high' || dBand === 'very_high'
        ? '精力充沛，行动力与助力运皆佳；过浓则传统主性躁气盛，易与人争'
        : dBand === 'balanced'
          ? '张弛有度，做事有分寸'
          : '传统主兄弟缘薄、助力寡少，情性偏冷',
      '神相全编',
    )

    const disp = bilateral(browPixels.left.tailDispersion, browPixels.right.tailDispersion)
    push(
      'face.brow.tail', '眉', disp < 0.12 ? '眉尾聚拢' : '眉尾疏散', disp < 0.12 ? 'high' : 'low',
      round(disp), 'inferred', conf('density'),
      `眉尾区域灰度标准差 ${disp.toFixed(3)}（越低越聚拢）`,
      disp < 0.12 ? '做事有始有终，责任心强' : '传统称眉尾散乱，主有始无终、心志易移，财帛亦难聚',
      '神相全编',
    )
  } else {
    unavailable.push({
      id: 'face.brow.density', label: '眉毛浓密度', reason: 'low_confidence',
      detail: '本次未能取得可用的眉部像素采样',
    })
  }

  /* ============ 眼 ============ */
  const eyeAspect = bilateral(m.eye.left.aspect, m.eye.right.aspect)
  const tiltAvg = bilateral(m.eye.left.canthalTilt, m.eye.right.canthalTilt)
  const eyeShape = classifyEye(eyeAspect, tiltAvg)
  push(
    'face.eye.shape', '眼', eyeShape.label, 'categorical', eyeShape.label, 'measured', conf('geometry'),
    `眼纵横比 ${eyeAspect.toFixed(3)}（眼高÷眼长），外眼角上扬 ${tiltAvg.toFixed(1)}°`,
    eyeShape.meaning, eyeShape.source,
  )

  const openness = bilateral(m.eye.left.openness, m.eye.right.openness)
  const opBand = toBand(openness, { veryLo: 0.5, lo: 0.62, hi: 0.85, veryHi: 0.95 })
  push(
    'face.eye.openness', '眼',
    opBand === 'high' || opBand === 'very_high' ? '眼神清明' : opBand === 'balanced' ? '目光平和' : '眼神含蓄',
    opBand, round(openness), 'measured', conf('geometry'),
    `虹膜可见比例 ${(openness * 100).toFixed(0)}%（由 468–477 虹膜点测得）`,
    opBand === 'high' || opBand === 'very_high'
      ? '心地清明，是非分明，观察力佳'
      : opBand === 'balanced'
        ? '目光温和，待人有度'
        : '传统称目光藏而不露，主城府较深、心事不轻示人',
    '麻衣神相',
  )

  // 三白眼
  const sclera = Math.max(
    bilateral(m.eye.left.scleraUpper, m.eye.right.scleraUpper),
    bilateral(m.eye.left.scleraLower, m.eye.right.scleraLower),
  )
  if (sclera > T.scleraShow) {
    push(
      'face.eye.sclera', '眼', '三白眼', 'categorical', round(sclera), 'measured', conf('geometry'),
      `虹膜上下方巩膜暴露达眼高的 ${(sclera * 100).toFixed(0)}%`,
      '传统列为忌相，主薄情寡义、六亲缘浅，性刚而执，行事以己意为先',
      '神相全编',
    )
  }

  /* ============ 鼻 ============ */
  const n = m.nose
  const straight = n.bridgeDeviation <= T.bridgeStraight
  push(
    'face.nose.bridge', '鼻', straight ? '鼻梁挺直' : '鼻梁微曲',
    straight ? 'high' : 'low', round(n.bridgeDeviation, 3), 'measured', conf('geometry'),
    `鼻梁中轴最大偏移为 IOD 的 ${(n.bridgeDeviation * 100).toFixed(1)}%（挺直线为 ${(T.bridgeStraight * 100).toFixed(0)}%）`,
    straight
      ? '为人正直，意志坚定，认准方向不易动摇'
      : '传统称鼻梁欹曲，主中年多蹇滞、心思偏曲，处事好变通而少定见',
    '麻衣神相',
  )

  const bhBand = toBand(n.bridgeHeight, T.bridgeHeight)
  push(
    'face.nose.root', '鼻',
    bhBand === 'high' || bhBand === 'very_high' ? '山根隆起' : bhBand === 'balanced' ? '山根平顺' : '山根偏平',
    bhBand, round(n.bridgeHeight), 'inferred', conf('shading'),
    `山根相对内眼角连线的深度突出量归一化后为 ${n.bridgeHeight.toFixed(2)}`,
    bhBand === 'high' || bhBand === 'very_high'
      ? '意志力强，中年主运，自我驱动足'
      : bhBand === 'balanced'
        ? '性情平和，进退有据'
        : '山根低陷，古法列为中年之忌，主意志易摇、根基不固，成事须仗外力',
    '神相全编',
  )

  const tfBand = toBand(n.tipFullness, T.tipFullness)
  push(
    'face.palace.caibo', '十二宫',
    tfBand === 'high' || tfBand === 'very_high' ? '准头丰圆' : tfBand === 'balanced' ? '准头端正' : '准头清秀',
    tfBand, round(n.tipFullness), 'inferred', conf('shading'),
    `鼻尖相对鼻翼的突出量归一化后为 ${n.tipFullness.toFixed(2)}`,
    tfBand === 'high' || tfBand === 'very_high'
      ? '财帛宫佳，善于积累，正财稳健'
      : tfBand === 'balanced'
        ? '用度有节，收支有数'
        : '准头尖薄，传统主财帛无根、聚散不定，重神而不重财',
    '麻衣神相',
  )

  const awBand = toBand(n.alarWidth, T.alarWidth)
  push(
    'face.nose.alar', '鼻',
    awBand === 'high' || awBand === 'very_high' ? '鼻翼丰满' : awBand === 'balanced' ? '鼻翼适中' : '鼻翼清秀',
    awBand, round(n.alarWidth), 'measured', conf('geometry'),
    `鼻翼宽为 IOD 的 ${(n.alarWidth * 100).toFixed(0)}%`,
    awBand === 'high' || awBand === 'very_high'
      ? '财库充实，守成有力'
      : '鼻翼薄削，传统主财库不固、进易出难，守成之力偏弱',
    '神相全编',
  )

  /* ============ 口 ============ */
  const mo = m.mouth
  const mwBand = toBand(mo.widthOverAlar, T.mouthAlar)
  push(
    'face.mouth.width', '口',
    mo.widthOverAlar >= T.mouthWide ? '口阔' : mwBand === 'balanced' ? '口形端正' : '口形秀气',
    mwBand, round(mo.widthOverAlar), 'measured', conf('geometry'),
    `口宽为鼻翼宽的 ${mo.widthOverAlar.toFixed(2)} 倍（传统以口大于鼻翼为佳）`,
    mo.widthOverAlar >= T.mouthWide
      ? '心胸宽广，有包容力，敢于表达'
      : mwBand === 'balanced'
        ? '言行得体，进退有度'
        : '口小于鼻，传统主气量偏窄、食禄不丰，遇事怯于开口',
    '麻衣神相',
  )

  const liftBand = toBand(mo.cornerLift, T.cornerLift)
  push(
    'face.mouth.corner', '口',
    mo.cornerLift >= T.cornerUp ? '口角上扬' : mo.cornerLift <= T.cornerDown ? '口角平缓' : '口角端平',
    liftBand, round(mo.cornerLift, 3), 'measured', conf('geometry'),
    `口角相对唇中线上扬量为口宽的 ${(mo.cornerLift * 100).toFixed(1)}%`,
    mo.cornerLift >= T.cornerUp
      ? '乐观开朗，人缘极佳'
      : mo.cornerLift <= T.cornerDown
        ? '口角下垂，传统主性情执拗、心多不平，与人相处失于亲和'
        : '神色平和，喜怒不形于色',
    '神相全编',
  )

  const ltBand = toBand(mo.lipThickness, T.lipThickness)
  push(
    'face.mouth.lip', '口',
    mo.lipThickness >= T.lipThick ? '唇厚' : mo.lipThickness <= T.lipThin ? '唇薄' : '唇厚适中',
    ltBand, round(mo.lipThickness), 'measured', conf('geometry'),
    `上下唇合计厚度为 IOD 的 ${(mo.lipThickness * 100).toFixed(0)}%`,
    mo.lipThickness >= T.lipThick
      ? '情感丰富，为人厚道'
      : mo.lipThickness <= T.lipThin
        ? '唇薄者传统主情性偏淡、待人少温，然言辞锋利、说理不让人'
        : '表达有分寸，情理兼顾',
    '麻衣神相',
  )

  const phBand = toBand(mo.philtrumLen, T.philtrumLen)
  push(
    'face.mouth.philtrum', '口',
    mo.philtrumLen >= T.philtrumLong ? '人中深长' : phBand === 'balanced' ? '人中端正' : '人中浅短',
    phBand, round(mo.philtrumLen), 'measured', conf('geometry'),
    `人中长度为 IOD 的 ${(mo.philtrumLen * 100).toFixed(0)}%`,
    mo.philtrumLen >= T.philtrumLong
      ? '传统主子女缘厚、晚年有依'
      : phBand === 'balanced'
        ? '家庭关系平顺'
        : '人中浅短，传统主六亲缘薄、晚景少依，家中之事多不由己',
    '柳庄相法',
  )

  /* ============ 田宅宫 ============ */
  const tzBand = toBand(m.tianzhai, T.tianzhai)
  push(
    'face.palace.tianzhai', '十二宫',
    tzBand === 'high' || tzBand === 'very_high' ? '田宅宽阔' : tzBand === 'balanced' ? '田宅平正' : '田宅紧凑',
    tzBand, round(m.tianzhai), 'measured', conf('geometry'),
    `眉眼间距为单眼宽的 ${m.tianzhai.toFixed(2)} 倍`,
    tzBand === 'high' || tzBand === 'very_high'
      ? '传统主居处安稳、置业有福，性情也偏宽和'
      : tzBand === 'balanced'
        ? '家宅安宁，起居有序'
        : '田宅逼窄，传统主居处不安、田产难守，性亦偏急',
    '神相全编',
  )

  /* ============ 对称 ============ */
  push(
    'face.symmetry', '对称',
    m.symmetryScore >= T.symmetryGood ? '五官端正' : '五官各具其态',
    m.symmetryScore >= T.symmetryGood ? 'high' : 'balanced',
    round(m.symmetryScore), 'measured', conf('geometry'),
    `${15} 组镜像点的中位偏差换算后，对称度为 ${(m.symmetryScore * 100).toFixed(0)}%`,
    m.symmetryScore >= T.symmetryGood
      ? '相貌宫端正，与人相处给人稳定可靠之感'
      : '面部左右各有其势，个人特征鲜明',
    '麻衣神相',
  )

  /* ============ 气色 ============ */
  if (complexion && complexionFactor > 0) {
    const cx = describeComplexion(complexion)
    push(
      'face.complexion', '气色', cx.label, cx.band, cx.value, 'inferred',
      conf('complexion', complexionFactor),
      cx.evidence, cx.meaning, '麻衣神相',
    )
  } else {
    unavailable.push({
      id: 'face.complexion', label: '气色', reason: 'low_confidence',
      detail: complexion === null
        ? '面部采样区域不足，无法得出可靠的气色判断'
        : '画面存在明显色偏或光照异常，气色受白平衡干扰过大，本次不作判断',
    })
  }

  /* ============ 五形与脸型 ============ */
  const five = classifyFiveElements(m)
  push(
    'face.fiveElements', '五形',
    five.primary === '兼形' ? '兼形之相' : `${five.primary}形之相`,
    'categorical', five.primary, 'measured', conf('geometry'),
    `面宽高比 ${m.contour.fw.toFixed(2)}，颌颧比 ${m.contour.jc.toFixed(2)}，额颧比 ${m.contour.fc.toFixed(2)}，下颌角 ${m.contour.gonialAngle.toFixed(0)}°`,
    FIVE_MEANING[five.primary], five.primary === '兼形' ? '神相全编' : '麻衣神相',
  )

  const faceShape = classifyFaceShape(m)
  push(
    'face.shape', '脸型', faceShape, 'categorical', faceShape, 'measured', conf('geometry'),
    `脸宽为 IOD 的 ${(m.contour.faceWidth * 100).toFixed(0)}%，脸高 ${(m.contour.faceHeight * 100).toFixed(0)}%，下巴曲率半径 ${m.contour.chinRadius.toFixed(2)}`,
    FACE_SHAPE_MEANING[faceShape], '神相全编',
  )

  /* ============ 不可观测项 ============ */
  unavailable.push({
    id: 'face.ear', label: '耳相', reason: 'not_observable',
    detail: '正面照中双耳常被头发遮挡，且面部网格不含耳廓细节点，无法测量耳形与耳位',
  })
  unavailable.push({
    id: 'face.mole', label: '痣与疤痕', reason: 'out_of_scope',
    detail: '本版本未启用皮肤标记检测',
  })

  const { features, unavailable: lowConf } = partitionByConfidence(drafts)

  /* ============ derived ============ */
  const palaceScores: [Palace, number][] = []
  const byId = new Map(features.map((f) => [f.id, f]))
  const PALACE_MAP: [string, Palace][] = [
    ['face.palace.mingGong', '命宫'],
    ['face.palace.caibo', '财帛宫'],
    ['face.palace.tianzhai', '田宅宫'],
    ['face.brow.length', '兄弟宫'],
  ]
  for (const [id, palace] of PALACE_MAP) {
    const f = byId.get(id)
    if (!f) continue
    const v = f.band === 'high' ? 0.9 : f.band === 'very_high' ? 0.6 : f.band === 'balanced' ? 0.75 : 0.3
    palaceScores.push([palace, v])
  }
  palaceScores.sort((a, b) => b[1] - a[1])

  const dominant = (['upper', 'middle', 'lower'] as const).reduce((a, b) => (c[a] >= c[b] ? a : b))

  const derived: MianxiangDerived = {
    fiveElements: {
      primary: five.primary,
      primaryScore: round(five.primaryScore),
      secondary: five.secondary,
      secondaryScore: five.secondaryScore === null ? null : round(five.secondaryScore),
    },
    faceShape,
    courtDominance: c.maxDiff <= T.courtBalanceTol ? 'balanced' : dominant,
    symmetryScore: m.symmetryScore,
    palaceHighlights: palaceScores.filter(([, v]) => v >= 0.75).slice(0, 3).map(([p]) => p),
    palaceCautions: palaceScores.filter(([, v]) => v < 0.5).slice(0, 2).map(([p]) => p),
    hairlineSource: 'mesh_top',
  }

  return { features, unavailable: [...unavailable, ...lowConf], derived }
}

/* ============================================================
   分类器
   ============================================================ */

interface Shape {
  label: string
  meaning: string
  source: Classic
}

/** 眉形五分类。词表沿用 lincerely/Face-Reading */
function classifyBrow(curve: number, tilt: number): Shape {
  if (curve < T.browStraight) {
    if (tilt > 8) {
      return { label: '大刀眉', meaning: '有勇有谋，好胜心强；性偏刚烈，争胜之心重', source: '神相全编' }
    }
    return { label: '一字眉', meaning: '果决有胆识，然性情执拗，认定之事不容人劝', source: '麻衣神相' }
  }
  if (tilt < -3) {
    return { label: '八字眉', meaning: '外冷内热，为人豁达不拘小节，然做事失于疏懒', source: '柳庄相法' }
  }
  if (curve >= T.browCrescentLo && curve <= T.browCrescentHi) {
    return { label: '新月眉', meaning: '心思细腻，有艺术气质，考虑周到', source: '神相全编' }
  }
  return { label: '清秀眉', meaning: '眉形匀顺，才思清晰，性情温和', source: '麻衣神相' }
}

/** 眼形五分类 */
function classifyEye(aspect: number, tilt: number): Shape {
  if (aspect >= T.eyeRound) {
    return { label: '圆眼', meaning: '直率热情，反应敏捷；情绪外露，藏不住事', source: '神相全编' }
  }
  if (aspect <= T.eyeNarrow && tilt >= T.canthalUp) {
    return { label: '丹凤眼', meaning: '聪明灵巧，爱憎分明；心有城府，喜怒不轻示人', source: '麻衣神相' }
  }
  if (tilt <= T.canthalDown) {
    return { label: '垂眼', meaning: '心思缜密，性情柔顺；然优柔少断，事到临头易退', source: '柳庄相法' }
  }
  if (aspect >= 0.33 && aspect <= 0.4 && tilt >= 2 && tilt <= T.canthalUp) {
    return { label: '桃花眼', meaning: '才艺人缘俱佳，然多情而心易动，情事上常有波折', source: '神相全编' }
  }
  return { label: '端正眼', meaning: '眼形匀称，处事持中，观察细致', source: '麻衣神相' }
}

const FIVE_MEANING: Record<FiveElement | '兼形', string> = {
  金: '刚毅果断，重义守则；失之则过于严苛，不容人过',
  木: '仁厚耿直，有才；然性偏孤介，不合流俗',
  水: '智慧灵活，善交际周旋；失之则心多机巧、意志不专',
  火: '热情积极，行动力强；性急气盛，事到临头难耐',
  土: '稳重踏实，重承诺积累；失之则迟钝守旧，少变通',
  兼形: '兼具多形，可塑性强；然形不纯，气亦驳杂，主一生起落多端',
}

const FACE_SHAPE_MEANING: Record<FaceShape, string> = {
  圆脸: '亲和随顺，人缘佳；然失于任性，遇事怕硬',
  瓜子脸: '心思细腻，审美佳；然神弱骨轻，任事之力不足',
  由字脸: '根基扎实，后劲足；早年不得力，须晚成',
  国字脸: '格局方正，担当力强，可信赖；性亦刚，少回旋',
  甲字脸: '思虑敏捷早慧，长于谋划；下停偏薄，晚运须早图',
}

function classifyFiveElements(m: FaceMetrics): {
  primary: FiveElement | '兼形'
  primaryScore: number
  secondary: FiveElement | null
  secondaryScore: number | null
} {
  const { fw, jc, fc, chinRadius } = m.contour
  const F = T.fiveElements
  const s = (v: boolean, w = 1) => (v ? w : 0)

  // 各形软打分，归一化到 0–1
  const scores: Record<FiveElement, number> = {
    金: (s(fw >= F.wideFW) + s(jc >= F.squareJC) + s(chinRadius <= F.sharpCR)) / 3,
    木: (s(fw <= F.narrowFW) * 1.5 + s(jc <= F.narrowJC)) / 2.5,
    水: (s(fw >= 0.75) + s(chinRadius >= F.roundCR) + s(jc >= F.narrowJC && jc <= F.fullJC)) / 3,
    火: (s(fc >= F.wideFC) * 1.5 + s(jc <= F.narrowJC) * 1.5) / 3,
    土: (s(fw >= 0.8) + s(jc >= F.fullJC) + s(chinRadius > F.sharpCR && chinRadius < F.roundCR)) / 3,
  }

  const ranked = (Object.entries(scores) as [FiveElement, number][]).sort((a, b) => b[1] - a[1])
  const [top, second] = ranked

  if (top[1] < F.minScore) {
    return { primary: '兼形', primaryScore: top[1], secondary: top[0], secondaryScore: top[1] }
  }
  return {
    primary: top[0],
    primaryScore: top[1],
    secondary: second[1] > 0.3 ? second[0] : null,
    secondaryScore: second[1] > 0.3 ? second[1] : null,
  }
}

function classifyFaceShape(m: FaceMetrics): FaceShape {
  const { fw, jc, fc, chinRadius } = m.contour
  const F = T.fiveElements

  if (fw >= F.wideFW && jc >= F.squareJC && chinRadius <= F.sharpCR) return '国字脸'
  if (fw >= 0.75 && chinRadius >= F.roundCR) return '圆脸'
  if (fc > jc + 0.12) return fw <= F.narrowFW ? '瓜子脸' : '甲字脸'
  if (jc > fc + 0.06) return '由字脸'
  return '瓜子脸'
}

function describeComplexion(cx: ComplexionResult): {
  label: string
  band: DraftFeature['band']
  value: string
  evidence: string
  meaning: string
} {
  const C = T.complexion
  const ev = `颧部相对全脸红度 ${cx.aRel > 0 ? '+' : ''}${cx.aRel}，黄度 ${cx.bRel > 0 ? '+' : ''}${cx.bRel}，明度均匀度 ${cx.uniformity}，高光占比 ${(cx.gloss * 100).toFixed(0)}%`
  const value = `a*相对 ${cx.aRel}，均匀度 ${cx.uniformity}`

  if (cx.uniformity < C.uneven) {
    return {
      label: '气色欠匀', band: 'low', value, evidence: ev,
      meaning: '面部明暗不太均匀，近期宜规律作息、多休息',
    }
  }
  if (cx.aRel >= C.ruddy && cx.uniformity >= C.uniformGood) {
    return {
      label: '红润有光泽', band: 'high', value, evidence: ev,
      meaning: '气血调和，近期状态在线',
    }
  }
  if (cx.aRel <= C.pale) {
    return {
      label: '苍白少华', band: 'low', value, evidence: ev,
      meaning: '面色偏淡，宜注重休息与饮食均衡',
    }
  }
  if (cx.bRel >= C.yellow && cx.overall.L >= C.brightL) {
    return {
      label: '黄明透亮', band: 'high', value, evidence: ev,
      meaning: '传统主运势渐开，精神状态尚可',
    }
  }
  if (cx.overall.L >= C.brightL) {
    return {
      label: '白净明亮', band: 'balanced', value, evidence: ev,
      meaning: '传统称之清贵之气，神色清爽',
    }
  }
  return {
    label: '气色平和', band: 'balanced', value, evidence: ev,
    meaning: '面色平稳，无明显起伏',
  }
}
