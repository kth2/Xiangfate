/**
 * 差异化诊断台 —— 回答一个问题：**不同的人，拿到的报告到底有多不一样。**
 *
 * 这台诊断的由来：多人试用后反馈「不同人的结果差不多」。
 * 那句话可以有四种解释，得分开量：
 *   1. 端侧几何测出来本来就没差别（测量层）
 *   2. 测出来有差别，但被分档吃掉了，落进同一档（阈值层）  ← 实测的主因
 *   3. 分档有差别，但断语表/评分卡把它抹平了（规则层）
 *   4. 前三层都有差别，但发给 AI 的 prompt 里差异部分占比太小（prompt 层）← 实测的主因
 *
 * 这里只提供**纯函数**的度量，不下结论；断言与门槛写在
 * __tests__/differentiation.test.ts 里，跑 `npm test` 就会回归。
 *
 * ⚠️ 纯函数，不碰 DOM —— 与 dev/validate.ts 同一约定。
 */

import type { BandSpec } from '@/core/band'
import type { AnalysisType, FeatureItem, Scorecard, ScoreDimension } from '@/core/types'
import { SCORE_DIMENSIONS } from '@/core/types'
import { collectVerdicts } from '@/core/verdicts'

/* ============================================================
   1. 人群模拟
   ============================================================ */

/**
 * 可复现的线性同余随机数 —— 诊断结果必须每次一样，否则门槛没法定。
 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Box–Muller，标准正态 */
export function seededNormal(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
}

/**
 * 人体测量学里常见的变异系数量级，用于模拟「一群人」而不是「一个人的重复测量」。
 *
 * ⚠️ 这些数不是本项目实测的人群分布 —— 项目至今只有 1 张真人脸夹具。
 * 它们的用途是**给阈值宽度一个可比的尺子**：线性距离之比的 CV 在文献里
 * 普遍落在 4%–7%，软组织/明暗推导量离散度更大。若某一档在 CV=6% 下
 * 仍吃掉九成以上的人，那这一档就不可能区分人 —— 这个结论不依赖 CV 的精确值。
 */
export const TYPICAL_CV = {
  /** 关键点直接算出的长度比（五眼、眉长比、口宽鼻翼比……） */
  linearRatio: 0.06,
  /** 归一化到 0–1 的明暗/深度推导量（山根高度、准头饱满度、掌丘……） */
  softTissue: 0.15,
  /** 角度类（外眦上扬、下颌角） */
  angle: 0.25,
} as const

/* ============================================================
   2. 分档集中度
   ============================================================ */

export interface FeatureConcentration {
  id: string
  label: string
  /** 该 id 在多少比例的样本里出现 */
  coverage: number
  /** 出现时，最常见的那一档占比 */
  topBandShare: number
  topBand: string
  /** 一共出现过几档 */
  distinctBands: number
  /** 出现时，最常见的那个传统术语占比 */
  topLabelShare: number
  distinctLabels: number
}

/**
 * 每条特征在人群里的集中度。
 *
 * topBandShare = 1 且 distinctBands = 1 意味着这条特征**对所有人给同一个判断** ——
 * 它在报告里占着篇幅，却不携带任何关于这个人的信息。
 */
export function featureConcentration(population: FeatureItem[][]): FeatureConcentration[] {
  const n = population.length
  const seen = new Map<string, { bands: Map<string, number>; labels: Map<string, number>; hits: number }>()

  for (const features of population) {
    for (const f of features) {
      let e = seen.get(f.id)
      if (!e) {
        e = { bands: new Map(), labels: new Map(), hits: 0 }
        seen.set(f.id, e)
      }
      e.hits++
      e.bands.set(f.band, (e.bands.get(f.band) ?? 0) + 1)
      e.labels.set(f.label, (e.labels.get(f.label) ?? 0) + 1)
    }
  }

  const top = (m: Map<string, number>): [string, number] =>
    [...m].sort((a, b) => b[1] - a[1])[0] ?? ['—', 0]

  return [...seen]
    .map(([id, e]) => {
      const [topBand, bandCount] = top(e.bands)
      const [topLabel, labelCount] = top(e.labels)
      return {
        id,
        label: topLabel,
        coverage: e.hits / n,
        topBandShare: bandCount / e.hits,
        topBand,
        distinctBands: e.bands.size,
        topLabelShare: labelCount / e.hits,
        distinctLabels: e.labels.size,
      }
    })
    .sort((a, b) => b.topBandShare - a.topBandShare || a.id.localeCompare(b.id))
}

/* ============================================================
   3. 断语多样性
   ============================================================ */

export interface VerdictStats {
  /** 断语名 → 命中率 */
  hitRate: Map<string, number>
  meanCount: number
  minCount: number
  maxCount: number
  /** 两两断语集合的平均 Jaccard 相似度。1 = 所有人一模一样 */
  meanJaccard: number
  /** 不同的断语组合数 */
  distinctSets: number
  /** 命中率 ≥ 0.9 的断语（人人都有，等于没说） */
  universal: string[]
}

export function verdictStats(population: FeatureItem[][], type: AnalysisType): VerdictStats {
  void type
  const n = population.length
  const sets = population.map((f) => new Set(collectVerdicts(f).map((v) => v.name)))
  const hits = new Map<string, number>()
  for (const s of sets) for (const name of s) hits.set(name, (hits.get(name) ?? 0) + 1)

  let jaccardSum = 0
  let pairs = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = sets[i]
      const b = sets[j]
      let inter = 0
      for (const x of a) if (b.has(x)) inter++
      const union = a.size + b.size - inter
      jaccardSum += union ? inter / union : 1
      pairs++
    }
  }

  const counts = sets.map((s) => s.size)
  const hitRate = new Map([...hits].map(([k, v]) => [k, v / n] as [string, number]))
  return {
    hitRate: new Map([...hitRate].sort((a, b) => b[1] - a[1])),
    meanCount: counts.reduce((a, b) => a + b, 0) / n,
    minCount: Math.min(...counts),
    maxCount: Math.max(...counts),
    meanJaccard: pairs ? jaccardSum / pairs : 1,
    distinctSets: new Set(sets.map((s) => [...s].sort().join('|'))).size,
    universal: [...hitRate].filter(([, r]) => r >= 0.9).map(([k]) => k),
  }
}

/* ============================================================
   4. 星级多样性
   ============================================================ */

export interface ScorecardStats {
  /** 维度 → 星级 → 占比 */
  distribution: Record<ScoreDimension, Map<number, number>>
  /** 维度 → 最常见星级的占比。1 = 该维度对所有人给同一个星数 */
  topShare: Record<ScoreDimension, number>
  /** 五维组合的种类数，上限 5^5 = 3125 */
  distinctCards: number
}

export function scorecardStats(cards: Scorecard[]): ScorecardStats {
  const n = cards.length
  const distribution = {} as Record<ScoreDimension, Map<number, number>>
  const topShare = {} as Record<ScoreDimension, number>

  for (const dim of SCORE_DIMENSIONS) {
    const hist = new Map<number, number>()
    for (const c of cards) hist.set(c[dim], (hist.get(c[dim]) ?? 0) + 1)
    distribution[dim] = new Map([...hist].sort((a, b) => a[0] - b[0]).map(([s, c]) => [s, c / n]))
    topShare[dim] = Math.max(...hist.values()) / n
  }

  return {
    distribution,
    topShare,
    distinctCards: new Set(cards.map((c) => SCORE_DIMENSIONS.map((d) => c[d]).join(','))).size,
  }
}

/* ============================================================
   5. 阈值带宽审计
   ============================================================ */

export interface BandAudit {
  name: string
  spec: BandSpec
  center: number
  /** 中和区半宽 ÷ 中心值。人体测量比例的人群 CV 多在 4%–7%，
   *  半宽远大于此则这一档必然吃掉绝大多数人 */
  relativeHalfWidth: number
  /** 假定近正态、给定 CV 时落入中和档的比例 */
  balancedShareAt: (cv: number) => number
}

/** 标准正态 CDF（Abramowitz–Stegun 7.1.26） */
export function normalCdf(z: number): number {
  const s = Math.sign(z)
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + s * y)
}

export function auditBand(name: string, spec: BandSpec): BandAudit | null {
  const center = (spec.lo + spec.hi) / 2
  if (!(Math.abs(center) > 1e-9)) return null
  const half = (spec.hi - spec.lo) / 2
  return {
    name,
    spec,
    center,
    relativeHalfWidth: half / Math.abs(center),
    balancedShareAt: (cv: number) => {
      const sd = Math.abs(center) * cv
      if (!(sd > 0)) return 1
      return normalCdf((spec.hi - center) / sd) - normalCdf((spec.lo - center) / sd)
    },
  }
}

/** 从阈值对象里递归挖出所有 BandSpec */
export function collectBandSpecs(root: unknown, prefix: string): [string, BandSpec][] {
  const out: [string, BandSpec][] = []
  const isSpec = (v: unknown): v is BandSpec =>
    !!v &&
    typeof v === 'object' &&
    (['veryLo', 'lo', 'hi', 'veryHi'] as const).every(
      (k) => typeof (v as Record<string, unknown>)[k] === 'number',
    )

  const walk = (obj: unknown, path: string) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return
    for (const [k, v] of Object.entries(obj)) {
      const p = `${path}.${k}`
      if (isSpec(v)) out.push([p, v])
      else walk(v, p)
    }
  }
  walk(root, prefix)
  return out
}

/* ============================================================
   6. prompt 差异率
   ============================================================ */

export interface PromptDivergence {
  /** 固定部分（System + 各类 HEAD + 格式要求）的字数 */
  sharedChars: number
  /** 两人之间真正不同的字数 */
  divergentChars: number
  /** 不同占模型全部输入的比例 —— 这个数决定了 AI 有多少余地写出不同的话 */
  divergenceRatio: number
  onlyInA: string[]
  onlyInB: string[]
}

/**
 * 两份 prompt 的行级差异。
 *
 * 为什么按行而不按字符：prompt 里的 JSON 是一行一个字段，
 * 行级差异正好对应「哪几项测出来不一样」，比字符级 diff 更好读。
 */
export function promptDivergence(systemPrompt: string, a: string, b: string): PromptDivergence {
  const linesOf = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
  const la = linesOf(a)
  const lb = linesOf(b)
  const setA = new Set(la)
  const setB = new Set(lb)
  const onlyInA = la.filter((l) => !setB.has(l))
  const onlyInB = lb.filter((l) => !setA.has(l))

  const divergentChars = onlyInA.join('').length
  const totalInput = systemPrompt.length + a.length
  return {
    sharedChars: totalInput - divergentChars,
    divergentChars,
    divergenceRatio: divergentChars / totalInput,
    onlyInA,
    onlyInB,
  }
}
