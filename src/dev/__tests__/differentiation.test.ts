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
import { buildOutline } from '@/core/outline'
import {
  auditBand,
  collectBandSpecs,
  featureConcentration,
  promptDivergence,
  outlineStats,
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
    // 对称度：以真人脸夹具的 0.85 为中心，而不是规范网格的 1.00 ——
    // 后者是参考模型的产物，真实人脸从来不是严格左右对称的。
    // 原来这里从 1.00 起扰动 6%，只有约 1% 的样本落到端正线以下，
    // 于是「五官端正」在合成人群里几乎恒定，掩盖了它对星级的单向推力。
    symmetryScore: Math.min(1, Math.max(0.6, 0.88 + n() * 0.06)),
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

    // 收窄后剩 3 个，且都不是真问题：
    // cornerLift / canthalTilt 中心在 0 附近，「半宽 ÷ 中心」对它们没有意义
    // （实测两张脸分别落 very_high / balanced，本来就能区分人）；
    // bridgeDeviation 已列入 core/evidenceOnly，不再下判断。
    // 这个数只许下降。
    expect(tooWide.length).toBeLessThanOrEqual(3)
    expect(audits.length).toBeGreaterThan(35)
  })
})

/* ============================================================
   2. 特征分档集中度
   ============================================================ */

/**
 * 已知「对所有人给同一判断」的特征 —— 待校准的债，不是设计。
 *
 * 目前为空。face.symmetry 曾在这张表上：它原来只有 high / balanced 两种输出，
 * 也就是只能给「端正」加分、从不减分，在星级里带权重 2 一路往上推。
 * 现已改为 high / low 两档（见 mianxiang/rules.ts 的说明）。
 */
const KNOWN_DEGENERATE: string[] = []

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

describe('虹膜可见度（openness）的判线', () => {
  /**
   * openness = 可见虹膜高 ÷ 虹膜直径。人的睑裂高度普遍**小于**虹膜直径
   * （虹膜约 11.7mm，睑裂高约 9–11mm），于是这个比值天然压在 0.6 上下。
   *
   * 原判线（硬写在 rules 里的 lo=0.62 / hi=0.85）是照传统「目宜露神」的语感定的：
   * 中和档的下沿就已经高于常见实测值，于是凡是测过的人都判「眼神含蓄」、
   * 都拿到忌相「目光藏 —— 城府较深」，而贵格「目光清明」（需 ≥0.85）
   * 在解剖上几乎不可能达到。判线现已按实测值重设（T.openness）。
   */
  it('两张实测脸都落在中和档内，而不是一律压在档外', () => {
    const values = [
      ['规范脸', (CANON.eye.left.openness + CANON.eye.right.openness) / 2],
      ['真人脸', (REAL.eye.left.openness + REAL.eye.right.openness) / 2],
    ] as const
    say('\n===== 虹膜可见度 =====')
    for (const [tag, v] of values) say(`  ${tag}: ${v.toFixed(3)}（中和区 [${T.openness.lo.toFixed(3)}, ${T.openness.hi.toFixed(3)}]）`)
    for (const [, v] of values) {
      expect(v).toBeGreaterThanOrEqual(T.openness.lo)
      expect(v).toBeLessThanOrEqual(T.openness.hi)
    }
  })

  it('「目光藏」不再是人人都有 —— 修正前两张脸都命中', () => {
    for (const m of [CANON, REAL]) {
      const names = [...verdictStats([runRules(m).features], 'mianxiang').hitRate.keys()]
      expect(names).not.toContain('目光藏')
    }
    // 人群里仍然有人命中，只是不再是全部
    const rate = verdictStats(FEATURE_SETS, 'mianxiang').hitRate.get('目光藏') ?? 0
    say(`  人群中「目光藏」命中率：${(rate * 100).toFixed(0)}%`)
    expect(rate).toBeLessThan(0.5)
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

  it('没有人人都有的断语 —— 一条断语命中九成以上的人就等于没说', () => {
    // 修正前有两条：「梁柱端正」98%（bridgeDeviation 判线不可达）、
    // 「印堂宽广」95%（browGap 中心错了 1.8 倍）。
    expect(stats.universal).toEqual([])
  })

  it('断语组合足够多样', () => {
    expect(stats.distinctSets).toBeGreaterThan(N * 0.7)
    expect(stats.meanJaccard).toBeLessThan(0.3)
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
    // 用户眼前看到的就是这张星级卡。理论上限 5^5 = 3125。
    // 四个阶段：起初 19 种（旧映射，balanced 恒落 4.25 星）→ 阈值收窄后 34 →
    // 星级映射重写后 110 → 补齐权重表后 120。钉住现状，只许上升。
    expect(stats.distinctCards).toBeGreaterThanOrEqual(118)
  })

  it('五档星数都有人拿到 —— 旧映射下 1 星与 2 星从无人拿到', () => {
    const seen = new Set<number>()
    for (const dim of SCORE_DIMENSIONS) {
      for (const [star, share] of stats.distribution[dim]) if (share > 0) seen.add(star)
    }
    say(`\n  人群中出现过的星数：${[...seen].sort().join('、')}`)
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('没有哪一维把过半的人压在同一星数上', () => {
    // 曾经的最集中项是「执行意志」70%，来由是权重表偏薄：
    // face.nose.bridge 转为只报数后，纯面相且无像素输入时它几乎只剩
    // face.nose.root 一条在撑。补齐权重表后该维从 10 条特征取值（7 条非像素），
    // 最集中降到 50%。覆盖审计见 core/__tests__/weights.test.ts。
    for (const dim of SCORE_DIMENSIONS) {
      expect(stats.topShare[dim], `${dim} 过于集中`).toBeLessThanOrEqual(0.55)
    }
  })
})

/* ============================================================
   5. 提纲多样性 —— 报告骨架是否随人而变
   ============================================================ */

describe('报告提纲多样性', () => {
  const outlines = FEATURE_SETS.map((f) => buildOutline(f).sections)
  const stats = outlineStats(outlines)

  it('列出分布', () => {
    say('\n===== 报告提纲 =====')
    say(`不同的段落序列：${stats.distinctOutlines} 种 / ${N} 人`)
    say(`段落集合两两 Jaccard 相似度：${(stats.meanJaccard * 100).toFixed(1)}%`)
    say('段数分布：' + [...stats.lengthHistogram].map(([k, v]) => `${k} 段 ${((v / N) * 100).toFixed(0)}%`).join('  '))
    say('各段入选率：')
    for (const [sec, rate] of stats.topicRate) say(`  ${(rate * 100).toFixed(0).padStart(4)}%  ${sec}`)
  })

  it('骨架不是所有人一样 —— 这是「读起来都一样」最直接的来由', () => {
    // 改造前骨架写死在 System Prompt 里：七段、顺序固定、每段还各有字数配额，
    // 于是 distinctOutlines 恒为 1。钉住现状，只许上升。
    expect(stats.distinctOutlines).toBeGreaterThanOrEqual(70)
    expect(stats.meanJaccard).toBeLessThan(0.85)
  })

  it('段数本身会变 —— 测到得多就多写一段，少就少写', () => {
    expect(stats.lengthHistogram.size).toBeGreaterThanOrEqual(4)
  })

  it('除核心段外，没有哪个专题段人人都有', () => {
    const core = ['特征识别', '断语', '性格特质', '状态提示', '发展建议']
    const alwaysOn = [...stats.topicRate]
      .filter(([sec, rate]) => rate >= 1 && !core.includes(sec))
      .map(([sec]) => sec)
    say(`\n  入选率 100% 的专题段：${alwaysOn.join('、') || '（无）'}`)
    expect(alwaysOn).toEqual([])
  })

  it('真人脸与规范脸拿到的骨架不同', () => {
    const a = buildOutline(runRules(REAL).features).sections
    const b = buildOutline(runRules(CANON).features).sections
    say(`\n  真人脸：${a.join(' → ')}`)
    say(`  规范脸：${b.join(' → ')}`)
    expect(a).not.toEqual(b)
  })

  it('关注方向会改变骨架 —— 它不再是 prompt 末尾的一句摆设', () => {
    const features = runRules(REAL).features
    const plain = buildOutline(features).sections
    const focused = buildOutline(features, ['想问财运与积累']).sections
    expect(focused).not.toEqual(plain)
  })
})

/* ============================================================
   6. prompt 差异率 —— AI 到底拿到了多少「这个人」的信息
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

    // 这是四问里最关键的一个数。改造前是 13.8%，且其中**全部**是 JSON 数值 ——
    // 指令部分（写哪几段、重心落在哪）对所有人一字不差。
    // 现在提纲与「最反常的几项」也因人而异，所以差异里含了指令。
    expect(d.divergenceRatio).toBeGreaterThan(0.15)

    // 指令部分必须真的不同，而不只是数字不同：
    // 提纲那几行出现在 onlyInA 里，才说明模型收到的「怎么写」也是因人而异的
    const instructionDiff = d.onlyInA.filter((l) => l.startsWith('##') || l.startsWith('· ##'))
    say(`其中属于提纲/指令的差异行：${instructionDiff.length} 行`)
    expect(instructionDiff.length).toBeGreaterThan(0)
  })

  it('真人脸与规范脸的特征标签不应大面积雷同', () => {
    const labels = (f: FeatureItem[]) =>
      new Map(f.filter((x) => !x.id.startsWith('face3d.')).map((x) => [x.id, x.label]))
    const a = labels(runRules(REAL).features)
    const b = labels(runRules(CANON).features)
    const shared = [...a].filter(([id, l]) => b.get(id) === l).length
    say(`\n两张脸共有的特征 id 中，术语相同的：${shared} / ${a.size}`)
    // 钉住现状（14/20）。校准推进后这个上限应当继续调低。
    expect(shared / a.size).toBeLessThanOrEqual(0.7)
  })
})
