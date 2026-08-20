/**
 * 权重表覆盖审计。
 *
 * 起因：五维星级里「执行意志」有 70% 的人压在 3 星，追下去发现不是映射的问题 ——
 * `face.nose.bridge` 转为只报数之后，纯面相且无像素输入时这一维只剩
 * `face.nose.root` 一条在撑。顺手清了一遍才发现有 11 条**测得出来、写进报告、
 * 却一个维度都没挂**的特征（法令纹、男女宫、婚姻线、三个掌丘、眉骨、骨盆、
 * 太阳穴、臂展），以及骨相的「人际情感」合计权重为 0。
 *
 * 信号一直在，只是没接到星级上。这组测试盯住三件事：
 *   1. 规则层能产出的 id，权重表都认得（明确豁免的除外）
 *   2. 权重表里没有对不上任何 id 的死键
 *   3. 每种相术的每一维都有足够的特征在撑，不会整维恒定中性
 *
 * 方法：**直接从 rules 源码里抽 id**，而不是另维护一份清单 ——
 * 清单会忘记更新，源码不会。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { isEvidenceOnly } from '../evidenceOnly'
import { MOLE_SLUG } from '@/modules/mianxiang/marks'
import { computeScorecard, WEIGHT_KEYS as ALL_KEYS, weightsForTest as weightsFor } from '../scorecard'
import { SCORE_DIMENSIONS, type AnalysisType, type Band, type FeatureItem, type ScoreDimension } from '../types'

/* ============================================================
   从源码抽取可产出的特征 id
   ============================================================ */

/**
 * 模板字符串里的替换项。规则层用 `` `face.threeCourts.${dominant}` `` 这类写法，
 * 静态抽取抽不出具体值，这里把可能的取值列出来。
 * ⚠️ 规则层新增这类模板 id 时要同步这里 —— 抽不到的 id 就审计不到，
 *    所以下面遇到没登记的模板会直接报错，而不是默默跳过。
 */
const TEMPLATE_EXPANSIONS: Record<string, string[]> = {
  dominant: ['upper', 'middle', 'lower'],
  weakest: ['upper', 'middle', 'lower'],
  'LINE_ID[name]': ['life', 'head', 'heart', 'fate', 'sun', 'marriage'],
  'MOUNT_ID[key]': ['jupiter', 'saturn', 'apollo', 'mercury', 'venus', 'moon', 'mars'],
  // 九骨里不可观测的那几根，只作为 unavailable 出现，从不是 feature
  bone: ['枕骨', '顶骨', '耳后骨'],
  // 痣按位置分列后的 id 片段，与 marks.ts 的 MOLE_SLUG 同源
  'MOLE_SLUG[position]': Object.values(MOLE_SLUG),
}

function readRules(module: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../modules/${module}/rules.ts`, import.meta.url)),
    'utf8',
  )
}

const ID_CHARS = '[a-z][A-Za-z0-9_.]*'

/** 把 `prefix${expr}suffix` 展开成具体 id */
function expandTemplate(prefix: string, expr: string, suffix: string): string[] {
  const key = expr.trim()
  const values = TEMPLATE_EXPANSIONS[key]
  expect(values, `模板 id \`${prefix}\${${key}}\` 没有登记替换项，审计会漏掉它`).toBeDefined()
  return values!.map((v) => prefix + v + suffix)
}

/**
 * 抽出该模块能产出的 **feature** id。
 *
 * 要与 unavailable 项分开：unavailable 是「这一项本次测不到」的说明，
 * 不是特征，本就不该有星级权重（`bone.nineBones.枕骨`、`bone.special` 之类）。
 * 两者在源码里的形态不同：
 *   feature      —— `push('face.brow.length', …)` 位置参数，或先 `const id = …` 再 push
 *   unavailable  —— `unavailable.push({ id: …, reason: … })` 对象字面量
 */
function extractFeatureIds(src: string): string[] {
  const out = new Set<string>()

  // push('face.brow.length', …)
  for (const m of src.matchAll(new RegExp(`push\\(\\s*\\n?\\s*'(${ID_CHARS})'`, 'g'))) {
    out.add(m[1])
  }
  // push(`face.threeCourts.${dominant}`, …)
  for (const m of src.matchAll(
    new RegExp(`push\\(\\s*\\n?\\s*\`(${ID_CHARS})\\$\\{([^}]+)\\}([A-Za-z]*)\``, 'g'),
  )) {
    for (const id of expandTemplate(m[1], m[2], m[3])) out.add(id)
  }
  // const id = `hand.line.${LINE_ID[name]}` —— 再传给 push
  for (const m of src.matchAll(
    new RegExp(`const id = \`(${ID_CHARS})\\$\\{([^}]+)\\}([A-Za-z]*)\``, 'g'),
  )) {
    for (const id of expandTemplate(m[1], m[2], m[3])) out.add(id)
  }
  for (const m of src.matchAll(new RegExp(`const id = '(${ID_CHARS})'`, 'g'))) out.add(m[1])

  return [...out].sort()
}

/** 只作为 unavailable 出现的 id，用于断言它们确实没被当成特征审计 */
function extractUnavailableIds(src: string): string[] {
  const out = new Set<string>()
  for (const m of src.matchAll(
    new RegExp(`id:\\s*'(${ID_CHARS})',[^}]*reason:`, 'gs'),
  )) {
    out.add(m[1])
  }
  for (const m of src.matchAll(
    new RegExp(`id:\\s*\`(${ID_CHARS})\\$\\{([^}]+)\\}([A-Za-z]*)\`,[^}]*reason:`, 'gs'),
  )) {
    for (const id of expandTemplate(m[1], m[2], m[3])) out.add(id)
  }
  return [...out].sort()
}

const MODULES: AnalysisType[] = ['mianxiang', 'shouxiang', 'guxiang', 'tixiang']
const SRC = Object.fromEntries(MODULES.map((m) => [m, readRules(m)])) as Record<AnalysisType, string>

const EMITTED = Object.fromEntries(
  MODULES.map((m) => [m, extractFeatureIds(SRC[m])]),
) as Record<AnalysisType, string[]>

const UNAVAILABLE_IDS = [...new Set(MODULES.flatMap((m) => extractUnavailableIds(SRC[m])))].sort()

const ALL_EMITTED = [...new Set(Object.values(EMITTED).flat())].sort()

/* ============================================================
   明确豁免
   ============================================================ */

/**
 * 刻意不给权重的特征，每条都要写清为什么。
 * 没有理由的项不许进这张表 —— 否则它会变成掩盖遗漏的地方。
 */
const UNWEIGHTED_ON_PURPOSE: Record<string, string> = {
  'face.mole.none':
    '「面上无显痣」是中和态，不承载偏离信号：它的档位是 balanced，进了星级也只贡献覆盖量而不贡献偏移。给它挂权重只会让「没有痣」看起来像一条测到的论据。',
}

/* ============================================================
   1. 覆盖
   ============================================================ */

describe('抽取本身是有效的', () => {
  it('每个模块都抽到了特征 id', () => {
    for (const m of MODULES) {
      expect(EMITTED[m].length, `${m} 一个 feature id 都没抽到，正则大概失效了`).toBeGreaterThan(4)
    }
  })

  it('unavailable 专用的 id 不被当成特征审计', () => {
    // bone.nineBones.枕骨 / bone.special / bone.body 这类只说明「测不到」，
    // 不是特征，本就不该有星级权重
    const onlyUnavailable = UNAVAILABLE_IDS.filter((id) => !ALL_EMITTED.includes(id))
    expect(onlyUnavailable.length).toBeGreaterThan(0)
    for (const id of onlyUnavailable) expect(weightsFor(id)).toBeUndefined()
  })
})

describe('权重表覆盖', () => {
  it('规则层能产出的每个 id，权重表都认得（豁免的除外）', () => {
    const orphans = ALL_EMITTED.filter(
      (id) => !weightsFor(id) && !(id in UNWEIGHTED_ON_PURPOSE) && !isEvidenceOnly(id),
    )
    expect(orphans, `这些特征测得出来、写进报告，却一个维度都没挂：\n  ${orphans.join('\n  ')}`).toEqual([])
  })

  it('豁免名单里的每一条都写了理由，且确实还在产出', () => {
    for (const [id, reason] of Object.entries(UNWEIGHTED_ON_PURPOSE)) {
      expect(reason.length, `${id} 的豁免理由太短`).toBeGreaterThan(20)
      expect(ALL_EMITTED, `${id} 已不再产出，该从豁免名单里删掉`).toContain(id)
    }
  })

  it('权重表里没有对不上任何 id 的死键', () => {
    // 死键通常是打错字或特征改名后留下的，它悄无声息 —— 权重白写了
    const dead = ALL_KEYS.filter(
      (key) => !ALL_EMITTED.some((id) => id === key || id.startsWith(key + '.')),
    )
    expect(dead, `这些权重键对不上任何能产出的特征：${dead.join('、')}`).toEqual([])
  })

  it('列入 evidenceOnly 的项不该同时挂权重 —— 挂了也不会生效，只会误导', () => {
    const contradictory = ALL_KEYS.filter((k) => isEvidenceOnly(k))
    expect(contradictory).toEqual([])
  })
})

/* ============================================================
   2. 每一维的厚度
   ============================================================ */

/** 某相术下，某一维有多少条特征在撑 */
function breadth(type: AnalysisType, dim: ScoreDimension): string[] {
  return EMITTED[type].filter((id) => {
    if (isEvidenceOnly(id)) return false
    return (weightsFor(id)?.[dim] ?? 0) > 0
  })
}

describe('每一维都有足够的特征在撑', () => {
  it.each(['mianxiang', 'shouxiang', 'guxiang', 'tixiang'] as AnalysisType[])(
    '%s：五维都不为空',
    (type) => {
      for (const dim of SCORE_DIMENSIONS) {
        const fs = breadth(type, dim)
        expect(
          fs.length,
          `${type} 的「${dim}」一条特征都没有 —— 这一维会恒定停在中性 3 星并标「未测到」`,
        ).toBeGreaterThan(0)
      }
    },
  )

  it('骨相的「人际情感」不再为空 —— 曾经合计权重为 0', () => {
    expect(breadth('guxiang', '人际情感').length).toBeGreaterThanOrEqual(3)
  })

  it('面相每一维都至少有 3 条特征，且不能全靠像素类输入', () => {
    // 像素类特征（眉毛浓密、法令、卧蚕、痣）在没取到图像时整批缺席。
    // 一维若全靠它们，纯关键点路径下就又只剩一两条在撑。
    const PIXEL_DEPENDENT = [
      'face.brow.density',
      'face.brow.tail',
      'face.nasolabial',
      'face.palace.nannv',
      'face.complexion',
    ]
    // 痣按位置分列后 id 是 face.mole.<slug>，整族都依赖像素
    const isPixelDependent = (id: string) =>
      PIXEL_DEPENDENT.includes(id) || id.startsWith('face.mole.')
    for (const dim of SCORE_DIMENSIONS) {
      const fs = breadth('mianxiang', dim)
      expect(fs.length, `面相「${dim}」只有 ${fs.length} 条`).toBeGreaterThanOrEqual(3)
      const geometric = fs.filter((id) => !isPixelDependent(id))
      expect(
        geometric.length,
        `面相「${dim}」的非像素类特征只有 ${geometric.length} 条：${fs.join('、')}`,
      ).toBeGreaterThanOrEqual(2)
    }
  })
})

/* ============================================================
   3. 痣按位置分列
   ============================================================ */

describe('痣的每个位置都挂上了维度', () => {
  it('MOLE_SLUG 的每个位置都有权重 —— 漏一个，那个位置的痣就到不了星级', () => {
    const missing = Object.entries(MOLE_SLUG).filter(
      ([, slug]) => !weightsFor(`face.mole.${slug}`),
    )
    expect(
      missing.map(([pos]) => pos),
      '这些位置的痣测得出来却没有权重',
    ).toEqual([])
  })

  it('每个位置的权重都落在与该位置相称的维度上', () => {
    // 抽查几个方向明确的：财帛类归根基福泽，感情类归人际情感，威令类归执行意志
    expect(weightsFor('face.mole.zhuntou')?.根基福泽).toBeGreaterThan(0)
    expect(weightsFor('face.mole.biyi')?.根基福泽).toBeGreaterThan(0)
    expect(weightsFor('face.mole.yanwei')?.人际情感).toBeGreaterThan(0)
    expect(weightsFor('face.mole.chunzhou')?.人际情感).toBeGreaterThan(0)
    expect(weightsFor('face.mole.faling')?.执行意志).toBeGreaterThan(0)
  })

  it('没有哪个位置的痣一条权重都不到 2 个维度以上 —— 单颗痣不该主导一维', () => {
    for (const slug of Object.values(MOLE_SLUG)) {
      const w = weightsFor(`face.mole.${slug}`)!
      const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0)
      expect(total, `face.mole.${slug} 权重合计 ${total}，过重`).toBeLessThanOrEqual(2)
    }
  })
})

/* ============================================================
   4. 三停按停分列
   ============================================================ */

describe('三停的权重按停分列', () => {
  it('中停挂执行意志 —— 规则层的释义就写着「意志与执行力居优」', () => {
    expect(weightsFor('face.threeCourts.middle')?.执行意志).toBeGreaterThan(0)
    expect(weightsFor('face.threeCourts.middleWeak')?.执行意志).toBeGreaterThan(0)
  })

  it('上停不挂执行意志 —— 它主早年与思虑，不主执行', () => {
    expect(weightsFor('face.threeCourts.upper')?.执行意志).toBeUndefined()
  })

  it('下停以根基福泽为主', () => {
    const w = weightsFor('face.threeCourts.lower')
    expect(w?.根基福泽).toBeGreaterThan(w?.执行意志 ?? 0)
  })

  it('特定项写全了权重 —— 最长前缀匹配不会从笼统项继承漏写的维度', () => {
    for (const id of [
      'face.threeCourts.middle',
      'face.threeCourts.middleWeak',
      'face.threeCourts.lower',
      'face.threeCourts.lowerWeak',
    ]) {
      // 笼统项给了气度格局，特定项也必须自己给，否则那一维就悄悄丢了
      expect(weightsFor(id)?.气度格局, `${id} 漏了气度格局`).toBeGreaterThan(0)
    }
  })
})

/* ============================================================
   4. 补权重之后，执行意志不再靠一条特征
   ============================================================ */

describe('执行意志不再单条独撑', () => {
  function feat(id: string, band: Band): FeatureItem {
    return {
      id,
      category: '三停',
      label: id,
      band,
      value: 1,
      status: 'measured',
      confidence: 0.9,
      evidence: 'ev',
      meaning: 'me',
      source: null,
    }
  }

  it('纯关键点的面相路径下，执行意志至少有 3 条特征可用', () => {
    const geometricOnly = ['face.threeCourts.middle', 'face.nose.root', 'face.brow.shape']
    const contributing = geometricOnly.filter((id) => (weightsFor(id)?.执行意志 ?? 0) > 0)
    expect(contributing.length).toBeGreaterThanOrEqual(3)
  })

  it('单独一条中停偏弱不足以把执行意志打到最低档', () => {
    // 收缩项应当挡住这一步；一条特征说不了整维的话
    const card = computeScorecard([feat('face.threeCourts.middleWeak', 'low')])
    expect(card.执行意志).toBeGreaterThan(1)
  })

  it('多条一致偏弱时才会真正落下来', () => {
    const card = computeScorecard([
      feat('face.threeCourts.middleWeak', 'low'),
      feat('face.nose.root', 'very_low'),
      feat('face.nasolabial', 'low'),
      feat('face.brow.tail', 'very_low'),
    ])
    expect(card.执行意志).toBeLessThanOrEqual(2)
  })
})
