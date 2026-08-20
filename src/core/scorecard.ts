/**
 * 本地五维评分卡。
 *
 * ⚠️ 刻意**不让 AI 生成**：同一张照片必须每次得到同样的星级。
 * 生成式模型做不到这一点，所以这件事归代码。
 *
 * ── 星级映射（2026-08 重写）──────────────────────────────
 * 星数读作：**这一维读起来是「有余」还是「不足」**，中和即为常，落在正中的 3 星。
 *
 *   偏移 δ(d) = Σ(weight × BAND_DELTA[band] × confidence)
 *              ────────────────────────────────────────    ∈ [−1, +1]
 *                    Σ(weight × confidence)
 *
 *   证据量 E(d) = Σ(weight × confidence)
 *   收缩后   δ' = δ × E / (E + PRIOR)
 *   星级       = clamp(1, 5, round(3 + 2 × δ'))
 *
 * 两处求和都**只把偏离档计入**，中和项既不进分子也不进分母。
 * 这一条是实测挑出来的：中和项若进分母，它们会把真正的偏离摊薄 ——
 * 一条偏高配五条中和，δ 只剩 0.2，星数回到 3。实测 200 人只有 21 种五维组合，
 * 比旧式子还差。中和的含义是「这一项没什么可说的」，
 * 不该有把别处的发现拉回中间的力量。
 *
 * 三件事各由一处负责，不再混在一个数里：
 *   · **方向与轻重** —— BAND_DELTA（core/band.ts），零点在中和
 *   · **刻度零点**   —— 上式里的常数 3
 *   · **证据够不够** —— 收缩项 E/(E+PRIOR)
 *
 * 旧式子是 `1 + (ratio − 0.1) / 0.8 × 4`，配 balanced=0.75 的绝对分值表，
 * 结果「各项都中和」恒等于 4.25 星 → 一律 4 星，1 星与 2 星从无人拿到，
 * 200 人只有 19 种五维组合。详见 core/band.ts 的 BAND_DELTA 注释与
 * src/dev/__tests__/differentiation.test.ts。
 * ────────────────────────────────────────────────────────
 */

import { BAND_DELTA, clamp, isScoredBand } from './band'
import { isEvidenceOnly } from './evidenceOnly'
import {
  SCORE_DIMENSIONS,
  type Classic,
  type FeatureItem,
  type ScoreDimension,
  type Scorecard,
} from './types'

/**
 * 特征 id 前缀 → 各维度权重。同一条特征可以贡献多个维度。
 *
 * ── 定权重的依据（2026-08 清过一遍）─────────────────────────
 * 每条权重都对得上**规则层自己写的 meaning 文本**，不是另起一套心理学量表。
 * 例如 `face.threeCourts.middle` 挂执行意志，因为规则层给它的释义就是
 * 「中年主运，意志与执行力居优」；`bone.boneFlesh` 挂人际情感，因为
 * 「骨露少肉，主性情孤峭、待人少回旋，六亲亦疏」。
 * 这样星级的来由与报告里的话必然一致 —— 用户点开某一维看到的理由，
 * 就是他在正文里读到的那句。
 *
 * 清过一遍才发现两类问题：
 *   · **11 条特征一个维度都没挂** —— 法令纹、男女宫、婚姻线、土星丘、太阳丘、
 *     火星丘、眉骨、骨盆、太阳穴、臂展。测得出来、写进报告，却到不了星级。
 *   · **骨相的「人际情感」合计权重为 0** —— 于是每份骨相报告这一维都恒定
 *     停在中性并标「未测到」，而规则层明明写着「待人少回旋」「好压人一头」
 *     「不喜冲突，相处轻松」。
 *
 * `src/core/__tests__/weights.test.ts` 直接从 rules 源码抽 id 做覆盖审计，
 * 新增特征忘了挂权重会直接红。
 * ────────────────────────────────────────────────────────
 */
type WeightMap = Record<string, Partial<Record<ScoreDimension, number>>>

const FACE_WEIGHTS: WeightMap = {
  /**
   * 三停按停分列 —— 不能笼统挂一个 `face.threeCourts`。
   * 三停各主一段，规则层给的释义就写明了各自所主：
   *   上停「早年得势，偏思虑型」· 中停「中年主运，**意志与执行力居优**」
   *   下停「晚运厚实，重根基与长期积累」
   * 笼统一条会把「中停丰隆」的执行力信号算到气度格局上去。
   * ⚠️ weightsFor 取最长前缀匹配，因此这里的每条特定项都要把该 id 的权重写全，
   *    写漏的维度不会从 'face.threeCourts' 那条继承。
   */
  'face.threeCourts': { 气度格局: 3, 根基福泽: 1 },
  'face.threeCourts.middle': { 气度格局: 2, 执行意志: 2 },
  'face.threeCourts.middleWeak': { 气度格局: 2, 执行意志: 2 },
  'face.threeCourts.lower': { 气度格局: 1, 根基福泽: 3, 执行意志: 1 },
  'face.threeCourts.lowerWeak': { 气度格局: 1, 根基福泽: 3, 执行意志: 1 },

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
  /**
   * face.nose.bridge 曾在这里挂「执行意志: 3」，是该维最重的一条。
   * 它已列入 core/evidenceOnly（判线离实测量级 11–52 倍），不再参与打分 ——
   * 于是执行意志一度只剩 face.nose.root 一条在撑（纯面相且无像素输入时）。
   * 不把权重挪回一条站不住的判线上，改为补齐真正测得到的那几项。
   */
  'face.nose.root': { 执行意志: 2, 才智思辨: 1 },
  'face.nose.alar': { 根基福泽: 2 },
  'face.mouth.width': { 人际情感: 2 },
  'face.mouth.corner': { 人际情感: 3 },
  'face.mouth.lip': { 人际情感: 1 },
  'face.mouth.philtrum': { 根基福泽: 2 },
  'face.palace.mingGong': { 才智思辨: 2, 气度格局: 1 },
  'face.palace.caibo': { 根基福泽: 3 },
  'face.palace.tianzhai': { 人际情感: 1, 根基福泽: 2 },
  /** 男女宫（卧蚕/泪堂）：「精神足、异性缘厚」/「心力多耗，情感上易劳神」 */
  'face.palace.nannv': { 人际情感: 2, 根基福泽: 1 },
  /** 法令：「威权已立、令行禁止，中晚年主事之相」/「威令未立…做事易被人越过」 */
  'face.nasolabial': { 执行意志: 2, 气度格局: 1 },
  'face.complexion': { 根基福泽: 1, 气度格局: 1 },
  /**
   * face.mole 刻意不给权重。
   *
   * 痣的相理是**按位置**分的（印堂见痣与颧见痣主的不是一件事），而这一项把
   * 所有位置压成一个 categorical 特征，标签是动态拼的。给它挂任何一个维度
   * 都是把「哪个位置」的信息丢掉之后瞎凑。它照旧进报告、进断语（走前缀匹配），
   * 只是不进星级。要让它参与打分，得先按位置拆成独立特征。
   */
}

const HAND_WEIGHTS: WeightMap = {
  'hand.type': { 气度格局: 2, 才智思辨: 1 },
  'hand.line.life': { 根基福泽: 3, 执行意志: 1 },
  'hand.line.head': { 才智思辨: 3 },
  'hand.line.heart': { 人际情感: 3 },
  'hand.line.fate': { 执行意志: 3, 气度格局: 1 },
  'hand.line.sun': { 气度格局: 1 },
  /** 婚姻线 —— 只主情缘亲疏 */
  'hand.line.marriage': { 人际情感: 2 },
  'hand.finger.thumb': { 执行意志: 2 },
  'hand.finger.index': { 气度格局: 1, 执行意志: 1 },
  'hand.finger.little': { 人际情感: 2 },
  'hand.mount.jupiter': { 气度格局: 1 },
  'hand.mount.venus': { 根基福泽: 2 },
  'hand.mount.mercury': { 人际情感: 1 },
  'hand.mount.moon': { 才智思辨: 1 },
  /** 土星丘：「稳重踏实，责任感强」/「偏重当下，无长远之谋」—— 稳重归根基，谋远归才智 */
  'hand.mount.saturn': { 执行意志: 2, 才智思辨: 1, 根基福泽: 1 },
  /** 太阳丘：「有艺术气质，乐观开朗」/ 过盛「好名浮夸」 */
  'hand.mount.apollo': { 气度格局: 1, 人际情感: 1 },
  /** 火星丘：「勇气十足，行动力强」/「遇事先观望而少决断」/ 过盛「争强好斗」 */
  'hand.mount.mars': { 执行意志: 2, 人际情感: 1 },
}

/**
 * 骨相的「人际情感」原来合计权重为 **0** —— 于是每一份骨相报告的这一维
 * 都恒定落在中性 3 星并标 neutralFallback，等于告诉用户「这一项我们测不了」。
 * 而规则层自己写的释义里明明有：骨露少肉「性情孤峭、待人少回旋，六亲亦疏」、
 * 权骨隆起「过显则好压人一头」、眉骨柔和「不喜冲突，相处轻松」。
 * 信号一直在，只是没接上。
 */
const BONE_WEIGHTS: WeightMap = {
  'bone.headShape': { 气度格局: 2, 才智思辨: 1 },
  'bone.zygomatic': { 执行意志: 2, 气度格局: 1, 人际情感: 1 },
  'bone.frontal': { 才智思辨: 3 },
  'bone.mandible': { 执行意志: 3 },
  'bone.boneFlesh': { 气度格局: 3, 根基福泽: 1, 人际情感: 2 },
  'bone.thickness': { 执行意志: 1, 根基福泽: 1 },
  'bone.shoulder': { 气度格局: 2 },
  'bone.spine': { 气度格局: 1, 执行意志: 1 },
  /** 眉骨：「性格有力度，对事情有掌控意愿」/「性情温和，不喜冲突，相处轻松」 */
  'bone.brow': { 执行意志: 2, 人际情感: 1 },
  /** 太阳穴（颞部）：「胆识过人，敢于尝试新路」/「进取有度，稳中求变」 */
  'bone.temporal': { 执行意志: 2, 才智思辨: 1 },
  /** 骨盆：「包容力强，根基稳」/「身形利落，行动轻捷」 */
  'bone.pelvis': { 根基福泽: 2, 执行意志: 1 },
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
  /** 臂展：「比例协调，传统视为平衡发展之相」/「肢体比例自有特点」 */
  'body.proportion.armReach': { 气度格局: 1 },
}

const WEIGHTS: WeightMap = {
  ...FACE_WEIGHTS,
  ...HAND_WEIGHTS,
  ...BONE_WEIGHTS,
  ...BODY_WEIGHTS,
}

/**
 * 仅供 __tests__/weights.test.ts 的覆盖审计使用。
 * 不是公开 API —— 星级一律走 computeScorecard / explainScorecard。
 */
export const weightsForTest = (id: string) => weightsFor(id)

/** 权重表的全部键，供覆盖审计查死键。同样只给测试用 */
export const WEIGHT_KEYS = Object.keys(WEIGHTS)

/** 找到最长匹配的前缀，允许 rules 里加子级 id 而不必改这张表 */
function weightsFor(id: string): Partial<Record<ScoreDimension, number>> | undefined {
  if (WEIGHTS[id]) return WEIGHTS[id]
  let best: string | undefined
  for (const key of Object.keys(WEIGHTS)) {
    if (id.startsWith(key + '.') && (!best || key.length > best.length)) best = key
  }
  return best ? WEIGHTS[best] : undefined
}

/** 刻度正中 —— 中和即为常 */
export const NEUTRAL_STARS = 3

/**
 * 证据量的先验，单位与 E(d) 相同（权重 × 置信度）。
 *
 * 作用是「证据少就别把话说满」：一个维度只由一条 shading 类特征撑着时
 * （E ≈ 1），它的偏移只按三成计入，星数留在 3 星附近；
 * 有五六条实测特征支撑时（E ≈ 8）按八成计入，1 星与 5 星都够得到。
 *
 * 这一项同时替掉了原来 `den < 0.5 → 3 星` 那个硬台阶 ——
 * 台阶两侧一边是 3 星、一边可能直接 5 星，差一条特征就能跳两星。
 * 现在是连续的，但 MIN_EVIDENCE 之下仍然明确标 neutralFallback：
 * 那种情况该告诉用户「本次没测到足够东西」，而不是给个看起来有依据的星数。
 *
 * 1.0 相当于「一条满权重、满置信度的偏离特征」。
 * 这个值是在合成人群上比过几档定的：0（不收缩）会让只由一条特征撑着的维度
 * 直接跳到 1 星或 5 星（实测「执行意志」出现 62% 3 星、25% 5 星而 4 星为空的断层）；
 * 2.0 收得太狠，五档只用得到中间三档。1.0 两头都够得到，且没有断层。
 * CALIBRATE —— 真实分布到手后应当按各维度的实际证据量分别定。
 */
export const EVIDENCE_PRIOR = 1.0

/** 低于此覆盖量就认为该维根本没测到，只报中性值并标记 neutralFallback */
export const MIN_EVIDENCE = 0.5

/** 某一维的偏移与证据量。computeScorecard 与 explainScorecard 共用，保证两边算法一致 */
interface DimensionRaw {
  /** Σ(weight × BAND_DELTA × confidence)，只累加偏离项 */
  weighted: number
  /** E(d) = Σ(weight × confidence)，只累加偏离项 —— 星级数学用这个 */
  evidence: number
  /**
   * 所有参与打分的项（含中和项）的 Σ(weight × confidence)。
   *
   * 只用来回答一个问题：**这一维到底测到东西了没有。**
   * 必须与 evidence 分开 —— 两种情况的星数都是 3，但要对用户说的话完全不同：
   *   coverage 很低          → 「本次没测到足够特征」
   *   coverage 够而 evidence 0 → 「各项均在中和区间」，这是结论，不是缺失
   * 混用会让报告把「这个人各项都平实」说成「我们没测到」。
   */
  coverage: number
}

function accumulate(features: FeatureItem[]): Record<ScoreDimension, DimensionRaw> {
  const acc = {} as Record<ScoreDimension, DimensionRaw>
  for (const dim of SCORE_DIMENSIONS) acc[dim] = { weighted: 0, evidence: 0, coverage: 0 }

  for (const f of features) {
    // 判线站不住的项不进星级 —— 否则一条错判会把每个人的同一维度一起推高或压低
    if (isEvidenceOnly(f.id)) continue
    // 分类项不在「有余/不足」这根轴上，完全不参与
    // （见 core/band.ts 的 BAND_DELTA 注释）
    if (!isScoredBand(f.band)) continue
    const w = weightsFor(f.id)
    if (!w) continue
    const delta = BAND_DELTA[f.band]
    for (const [dim, weight] of Object.entries(w) as [ScoreDimension, number][]) {
      const wc = weight * f.confidence
      acc[dim].coverage += wc
      // 中和项只算「测到了」，不进星级数学 —— 否则它们把真正的偏离摊薄
      if (delta === 0) continue
      acc[dim].weighted += delta * wc
      acc[dim].evidence += wc
    }
  }
  return acc
}

/** 该维是否根本没测到东西（区别于「测到了，但各项都在中和区间」） */
function isNeutralFallback(raw: DimensionRaw): boolean {
  return raw.coverage < MIN_EVIDENCE
}

/** 把一维的原始量换算成星级。两个入口都走这里，不许各算各的 */
function starsOf(raw: DimensionRaw): number {
  // 没测到东西的维度回落到中性，而不是 1 星 —— 没测到不等于差
  if (isNeutralFallback(raw)) return NEUTRAL_STARS
  // 测到了但一项都不偏离 → 偏移为 0 → 正好 3 星。这是结论，不是缺失
  if (raw.evidence <= 0) return NEUTRAL_STARS
  const delta = raw.weighted / raw.evidence
  const shrunk = delta * (raw.evidence / (raw.evidence + EVIDENCE_PRIOR))
  return clamp(Math.round(NEUTRAL_STARS + 2 * shrunk), 1, 5)
}

/**
 * 算五维星级。
 * 特征不足的维度回落到 3 星（中性），而不是 1 星 —— 没测到不等于差。
 */
export function computeScorecard(features: FeatureItem[]): Scorecard {
  const acc = accumulate(features)
  const out = {} as Scorecard
  for (const dim of SCORE_DIMENSIONS) out[dim] = starsOf(acc[dim])
  return out
}

/* ============================================================
   星级的来由
   ============================================================ */

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
  const acc = accumulate(features)
  const buckets: Record<ScoreDimension, DimensionDriver[]> = {
    气度格局: [],
    才智思辨: [],
    人际情感: [],
    执行意志: [],
    根基福泽: [],
  }

  for (const f of features) {
    if (isEvidenceOnly(f.id)) continue
    if (!isScoredBand(f.band)) continue
    const w = weightsFor(f.id)
    if (!w) continue
    const delta = BAND_DELTA[f.band]
    // 偏移为 0（中和）的不算驱动项：它既没往上推也没往下拉，
    // 列出来只会稀释真正的理由
    if (delta === 0) continue
    for (const [dim, weight] of Object.entries(w) as [ScoreDimension, number][]) {
      buckets[dim].push({
        id: f.id,
        label: f.label,
        meaning: f.meaning,
        source: f.source,
        direction: f.band === 'very_high' ? 'excess' : delta > 0 ? 'up' : 'down',
        influence: weight * f.confidence * Math.abs(delta),
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
      // 与 computeScorecard 里的回落条件保持一致 —— 用 coverage 而不是 evidence：
      // 「各项都在中和区间」不是「没测到」
      neutralFallback: isNeutralFallback(acc[dim]),
      drivers,
    }
  }
  return out
}

/** 各维度的一句话说明，报告页展示用 */
export const DIMENSION_DESC: Record<ScoreDimension, string> = {
  气度格局: '整体格局与气象',
  才智思辨: '思考与判断的取向',
  人际情感: '与人相处的方式',
  执行意志: '推动事情的力度',
  根基福泽: '积累与稳定性',
}
