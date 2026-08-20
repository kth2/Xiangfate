/**
 * 差异化回归 —— 盯住「不同的人拿到的报告有多不一样」。
 *
 * 起因：多人试用后反馈「换个人测，结果差不多」。这一组测试把那句话拆成可测的量，
 * 并把当前的实测值**钉住**：数字只许往好的方向走，退步就红。
 *
 * 方法：没有人群样本，于是用 MediaPipe 规范脸做中心、按人体测量学常见的变异系数
 * 合成一群「不同的人」。这不是真实分布（见 dev/differentiation.ts 的说明），
 * 但足以回答「这一档能不能区分人」—— 若某档在 CV=6% 下仍吃掉九成以上的人，
 * 那它对任何真实人群也一样吃掉九成以上。
 *
 * 报告表格：`DIFF_REPORT=/tmp/x.txt npm test -- differentiation` 会把明细写出来。
 */

import { describe, expect, it } from 'vitest'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import type { P3 } from '@/core/geom'
import { round } from '@/core/band'
import { computeScorecard } from '@/core/scorecard'
import { SCHEMA_VERSION, SCORE_DIMENSIONS, type AnalysisEnvelope, type FeatureItem } from '@/core/types'
import { SYSTEM_PROMPT } from '@/prompts/system'
import { buildUserPrompt } from '@/prompts/user'
import { computeFaceMetrics, type FaceMetrics } from '@/modules/mianxiang/metrics'
import { applyFaceRules } from '@/modules/mianxiang/rules'
import { T } from '@/modules/mianxiang/thresholds'
import { T as TH } from '@/modules/shouxiang/thresholds'
import { T as TG } from '@/modules/guxiang/thresholds'
import { T as TB } from '@/modules/tixiang/thresholds'
import {
  auditBand,
  collectBandSpecs,
  featureConcentration,
  promptDivergence,
  scorecardStats,
  seededNormal,
  seededRandom,
  TYPICAL_CV,
  verdictStats,
} from '../differentiation'
import { IMG_H, IMG_W, projectCanonical } from '@/modules/mianxiang/__tests__/canonical'

/* ============================================================
   报告输出
   ============================================================ */

const REPORT = process.env.DIFF_REPORT
if (REPORT) writeFileSync(REPORT, '')
const say = (...a: unknown[]) => {
  if (REPORT) appendFileSync(REPORT, a.map(String).join(' ') + '\n')
}

/* ============================================================
   夹具
   ============================================================ */

const CANON = computeFaceMetrics(projectCanonical(), IMG_W, IMG_H)

const realFixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../tests/fixtures/real-face-landmarks.json', import.meta.url)),
    'utf8',
  ),
) as { width: number; height: number; landmarks: [number, number, number][] }
const REAL = computeFaceMetrics(
  realFixture.landmarks.map(([x, y, z]) => ({ x, y, z })) as P3[],
  realFixture.width,
  realFixture.height,
)

/** 合成一个「不同的人」：按各量纲的典型变异系数扰动规范脸的度量 */
function syntheticPerson(base: FaceMetrics, seed: number): FaceMetrics {
  const n = seededNormal(seededRandom(seed))
  const jit = (v: number, cv: number) => v * (1 + n() * cv)
  const L = TYPICAL_CV.linearRatio
  const S = TYPICAL_CV.softTissue

  const up = jit(base.threeCourts.upper, L)
  const mid = jit(base.threeCourts.middle, L)
  const low = jit(base.threeCourts.lower, L)
  const sum = up + mid + low || 1
  const courts = { upper: up / sum, middle: mid / sum, lower: low / sum, maxDiff: 0 }
  courts.maxDiff = Math.max(
    Math.abs(courts.upper - courts.middle),
    Math.abs(courts.middle - courts.lower),
    Math.abs(courts.upper - courts.lower),
  )

  const brow = (s: FaceMetrics['brow']['left']) => ({
    ...s,
    lenRatio: jit(s.lenRatio, L),
    curvature: jit(s.curvature, S),
    gapRatio: jit(s.gapRatio, L),
  })
  const eye = (s: FaceMetrics['eye']['left']) => ({
    ...s,
    aspect: jit(s.aspect, TYPICAL_CV.softTissue * 0.6),
    canthalTilt: s.canthalTilt + n() * 3.5,
    openness: Math.min(1, jit(s.openness, TYPICAL_CV.softTissue * 0.6)),
  })

  return {
    ...base,
    threeCourts: courts,
    fiveEye: jit(base.fiveEye, L),
    innerGap: jit(base.innerGap, L),
    tianzhai: jit(base.tianzhai, S * 0.7),
    symmetryScore: Math.min(1, base.symmetryScore * (1 - Math.abs(n()) * 0.06)),
    brow: { left: brow(base.brow.left), right: brow(base.brow.right) },
    eye: { left: eye(base.eye.left), right: eye(base.eye.right) },
    nose: {
      ...base.nose,
      len: jit(base.nose.len, L),
      alarWidth: jit(base.nose.alarWidth, L),
      aspect: jit(base.nose.aspect, L),
      bridgeHeight: jit(base.nose.bridgeHeight, S),
      tipFullness: jit(base.nose.tipFullness, S),
      bridgeDeviation: Math.abs(base.nose.bridgeDeviation + n() * 0.012),
    },
    mouth: {
      ...base.mouth,
      widthOverAlar: jit(base.mouth.widthOverAlar, L),
      lipThickness: jit(base.mouth.lipThickness, S),
      philtrumLen: jit(base.mouth.philtrumLen, S * 0.7),
      cornerLift: base.mouth.cornerLift + n() * 0.02,
    },
    contour: {
      ...base.contour,
      fw: jit(base.contour.fw, L * 0.8),
      jc: jit(base.contour.jc, L),
      fc: jit(base.contour.fc, L),
      chinRadius: jit(base.contour.chinRadius, S),
    },
  }
}

function runRules(m: FaceMetrics) {
  return applyFaceRules({
    m,
    qualityFactor: 0.9,
    complexionFactor: 0.8,
    detectorScore: 0.95,
    complexion: null,
    browPixels: null,
    foreheadOccluded: false,
    moles: null,
    eyeBags: null,
    nasolabial: null,
  })
}

const N = 200
const POPULATION = Array.from({ length: N }, (_, i) => runRules(syntheticPerson(CANON, 9973 + i * 7919)))
const FEATURE_SETS = POPULATION.map((r) => r.features.filter((f) => !f.id.startsWith('face3d.')))

/* ============================================================
   1. 阈值带宽：中和区相对人群离散度有多宽
   ============================================================ */

describe('阈值带宽审计', () => {
  const specs = [
    ...collectBandSpecs(T, '面相'),
    ...collectBandSpecs(TH, '手相'),
    ...collectBandSpecs(TG, '骨相'),
    ...collectBandSpecs(TB, '体相'),
  ]

  it('列出每一档在 CV=6% 人群下吃掉多少人', () => {
    const audits = specs
      .map(([name, s]) => auditBand(name, s))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .sort((a, b) => b.relativeHalfWidth - a.relativeHalfWidth)

    say('===== 中和区带宽审计（半宽 ÷ 中心值）=====')
    say('阈值'.padEnd(28) + '半宽'.padStart(9) + '   CV=4%  CV=6%  CV=10% CV=15%')
    for (const a of audits) {
      say(
        a.name.padEnd(28) +
          `±${(a.relativeHalfWidth * 100).toFixed(1)}%`.padStart(9) +
          [0.04, 0.06, 0.1, 0.15]
            .map((cv) => `${(a.balancedShareAt(cv) * 100).toFixed(0)}%`.padStart(7))
            .join(''),
      )
    }

    // 半宽 > ±25% 的档，在任何可信的人群离散度下都吃掉九成以上的人 ——
    // 这些特征占着报告篇幅却不携带关于这个人的信息。
    const tooWide = audits.filter((a) => a.relativeHalfWidth > 0.25).map((a) => a.name)
    say(`\n半宽 > ±25%（几乎不可能区分人）的档：${tooWide.length} / ${audits.length}`)
    for (const t of tooWide) say('  ' + t)

    // 钉住现状：这个数只许下降。校准落地后把期望值一起改小。
    expect(tooWide.length).toBeLessThanOrEqual(15)
    expect(audits.length).toBeGreaterThan(35)
  })
})

/* ============================================================
   2. 特征分档集中度
   ============================================================ */

/**
 * 已知「对所有人给同一判断」的特征 —— 待校准的债，不是设计。
 *
 * · face.symmetry：判线 symmetryGood=0.85 之上只有一档，合成人群与真人脸
 *   都落在 high。真实人群的对称度应当更散，需要真实样本重定判线。
 */
const KNOWN_DEGENERATE = ['face.symmetry']

describe('特征分档集中度', () => {
  const conc = featureConcentration(FEATURE_SETS)

  it('列出每条特征的集中度', () => {
    say('\n===== 特征分档集中度（合成人群 N=' + N + '）=====')
    say('覆盖率  最常见档占比  特征'.padEnd(30) + '  档数 术语数')
    for (const c of conc) {
      say(
        `${(c.coverage * 100).toFixed(0).padStart(4)}%  ${(c.topBandShare * 100).toFixed(0).padStart(9)}%  ` +
          `${c.id.padEnd(30)} ${String(c.distinctBands).padStart(4)} ${String(c.distinctLabels).padStart(5)}  ${c.topBand}/${c.label}`,
      )
    }
  })

  it('除已知待校准项外，没有哪条特征对所有人给同一个判断', () => {
    const degenerate = conc
      .filter((c) => c.coverage > 0.95 && c.distinctBands === 1 && c.topBand !== 'categorical')
      .map((c) => c.id)
    say(`\n对所有人同一判断的特征：${degenerate.join('、') || '（无）'}`)
    expect(degenerate.sort()).toEqual([...KNOWN_DEGENERATE].sort())
  })

  it('印堂宽（命宫）不再对所有人判 very_high —— 阈值中心修正的回归', () => {
    // 修正前 browGap 的中心写成 0.53，而实测值约 0.94，
    // 于是全人群 very_high、「印堂宽广」与「印堂偏窄」两条断语都永不命中。
    const ming = conc.find((c) => c.id === 'face.palace.mingGong')
    expect(ming).toBeDefined()
    expect(ming!.distinctBands).toBeGreaterThan(1)
    expect(ming!.topBandShare).toBeLessThan(0.95)
  })
})

describe('虹膜可见度（openness）的结构性偏低', () => {
  /**
   * openness = 可见虹膜高 ÷ 虹膜直径。人的睑裂高度普遍**小于**虹膜直径
   * （虹膜约 11.7mm，睑裂高约 9–11mm），于是这个比值天然压在 0.6 上下，
   * 而档位判线是 lo=0.62 / hi=0.85 —— 中和档的下沿就已经高于常见值。
   *
   * 后果：项目现有的两张脸都判「眼神含蓄」，并由此命中忌相
   * 「目光藏 —— 城府较深、心事不轻示人」。也就是说凡是测过的人，
   * 都被告知城府深。这一条判线必须用真实样本重定。
   */
  const OPENNESS_BAND = { lo: 0.62, hi: 0.85 }

  it('两张实测脸都落在中和档之下', () => {
    const values = [
      ['规范脸', (CANON.eye.left.openness + CANON.eye.right.openness) / 2],
      ['真人脸', (REAL.eye.left.openness + REAL.eye.right.openness) / 2],
    ] as const
    say('\n===== 虹膜可见度 =====')
    for (const [tag, v] of values) say(`  ${tag}: ${v.toFixed(3)}（中和档下沿 ${OPENNESS_BAND.lo}）`)
    for (const [, v] of values) expect(v).toBeLessThan(OPENNESS_BAND.lo)
  })

  it('两张实测脸都因此命中忌相「目光藏」', () => {
    for (const m of [CANON, REAL]) {
      const names = verdictStats([runRules(m).features], 'mianxiang').hitRate
      expect([...names.keys()]).toContain('目光藏')
    }
  })
})

/* ============================================================
   3. 断语多样性
   ============================================================ */

describe('断语多样性', () => {
  const stats = verdictStats(FEATURE_SETS, 'mianxiang')

  it('列出命中率', () => {
    say('\n===== 断语命中率 =====')
    for (const [name, rate] of stats.hitRate) say(`${(rate * 100).toFixed(0).padStart(4)}%  ${name}`)
    say(`条数：均值 ${stats.meanCount.toFixed(1)}（${stats.minCount}–${stats.maxCount}）`)
    say(`两两 Jaccard 相似度：${(stats.meanJaccard * 100).toFixed(1)}%`)
    say(`不同的断语组合：${stats.distinctSets} 种 / ${N} 人`)
    say(`人人都有的断语（≥90%）：${stats.universal.join('、') || '（无）'}`)
  })

  it('人人都有的断语不超过 2 条 —— 每一条都等于没说', () => {
    // 「目光藏」来自 face.eye.openness 的结构性缺陷（见 KNOWN_DEGENERATE），
    // 「梁柱端正」来自 bridgeDeviation 判线过宽（±42.9%）。两条都待校准。
    expect(stats.universal.length).toBeLessThanOrEqual(2)
  })

  it('断语组合足够多样', () => {
    expect(stats.distinctSets).toBeGreaterThan(N * 0.4)
    expect(stats.meanJaccard).toBeLessThan(0.6)
  })
})

/* ============================================================
   4. 星级多样性
   ============================================================ */

describe('星级多样性', () => {
  const cards = POPULATION.map((r) => computeScorecard(r.features))
  const stats = scorecardStats(cards)

  it('列出分布', () => {
    say('\n===== 五维星级分布 =====')
    for (const dim of SCORE_DIMENSIONS) {
      const d = stats.distribution[dim]
      say(
        `${dim}: ` +
          [1, 2, 3, 4, 5].map((s) => `${s}★=${((d.get(s) ?? 0) * 100).toFixed(0)}%`).join('  ') +
          `   最集中 ${(stats.topShare[dim] * 100).toFixed(0)}%`,
      )
    }
    say(`不同的五维组合：${stats.distinctCards} 种 / ${N} 人（上限 3125）`)
  })

  it('没有哪个维度对所有人给同一星数', () => {
    const stuck = SCORE_DIMENSIONS.filter((d) => stats.topShare[d] >= 0.99)
    say(`\n星数写死的维度：${stuck.join('、') || '（无）'}`)
    expect(stuck).toEqual([])
  })

  it('五维组合的种类数不至于寥寥可数', () => {
    // 用户眼前看到的就是这张星级卡。理论上限 5^5 = 3125，
    // 当前只有 19 种 —— 这个数本身就是「换个人结果差不多」的直接来源：
    // BAND_VALUE.balanced = 0.75 经 (ratio-0.1)/0.8 映射后落在 4.25 星，
    // 于是中和区里的人几乎一律 4 星。钉住现状，只许上升。
    expect(stats.distinctCards).toBeGreaterThanOrEqual(19)
  })
})

/* ============================================================
   5. prompt 差异率 —— AI 到底拿到了多少「这个人」的信息
   ============================================================ */

function envelopeOf(m: FaceMetrics): AnalysisEnvelope {
  const { features, unavailable, derived } = runRules(m)
  return {
    schemaVersion: SCHEMA_VERSION,
    analysisType: 'mianxiang',
    analysisId: 'diff-probe',
    capturedAt: '2026-01-01T00:00:00.000Z',
    locale: 'zh-CN',
    capture: {
      shots: ['front'],
      quality: { score: 0.9, resolution: 'ok', lighting: 'ok', sharpness: 'ok', occlusion: [], issues: [] },
    },
    features,
    derived,
    raw: {
      normalizer: { type: 'IOD', valuePx: round(m.iodPx, 1) },
      metrics: {
        三停: `${round(m.threeCourts.upper, 3)} / ${round(m.threeCourts.middle, 3)} / ${round(m.threeCourts.lower, 3)}`,
        五眼: round(m.fiveEye),
        眼距: round(m.innerGap),
        鼻长: round(m.nose.len),
        鼻翼宽: round(m.nose.alarWidth),
        口宽鼻翼比: round(m.mouth.widthOverAlar),
        对称度: m.symmetryScore,
        田宅: round(m.tianzhai),
      },
    },
    unavailable,
    scorecard: computeScorecard(features),
    policy: { disclaimerRequired: true, forbidTopics: [] },
  }
}

describe('prompt 差异率', () => {
  it('两个明显不同的人，模型收到的输入有多少是不同的', () => {
    const d = promptDivergence(
      SYSTEM_PROMPT,
      buildUserPrompt(envelopeOf(REAL)),
      buildUserPrompt(envelopeOf(CANON)),
    )
    say('\n===== prompt 差异率（真人脸 vs 规范脸）=====')
    say(`System prompt ${SYSTEM_PROMPT.length} 字（两人完全相同）`)
    say(`模型全部输入中，因人而异的部分：${d.divergentChars} 字 → ${(d.divergenceRatio * 100).toFixed(1)}%`)
    say(`只出现在真人脸那一份里的行：${d.onlyInA.length} 行`)
    for (const l of d.onlyInA) say('  A| ' + l)

    // 这是四问里最关键的一个数。差异率过低时，System 里那套
    // 「七段 + 每段字数 + 固定小标题」的模板会主导输出，
    // 于是不同的人读到几乎同一篇文章 —— 与知识库大小无关。
    expect(d.divergenceRatio).toBeGreaterThan(0.1)
  })

  it('真人脸与规范脸的特征标签不应大面积雷同', () => {
    const labels = (f: FeatureItem[]) =>
      new Map(f.filter((x) => !x.id.startsWith('face3d.')).map((x) => [x.id, x.label]))
    const a = labels(runRules(REAL).features)
    const b = labels(runRules(CANON).features)
    const shared = [...a].filter(([id, l]) => b.get(id) === l).length
    say(`\n两张脸共有的特征 id 中，术语相同的：${shared} / ${a.size}`)
    // 钉住现状。校准推进后这个上限应当继续调低。
    expect(shared / a.size).toBeLessThanOrEqual(0.8)
  })
})
