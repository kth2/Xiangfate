/**
 * guard 是唯一一道不依赖模型配合的防线，必须有硬测试。
 * 每一条用例都对应 docs/07-content-policy.md 里的一类问题内容。
 */

import { describe, expect, it } from 'vitest'
import { finalizeReport, guardReport, preflightQuestion } from '../guard'
import { CORE_SECTIONS } from '../guard.rules'
import type { UnavailableItem } from '../types'

/**
 * 造一份结构合法、长度达标的报告，把待测句子插进「性格特质」。
 *
 * 骨架不再写死七段：核心段 + 一段专题，正好落在 SECTION_COUNT 的下限之上。
 */
const SAMPLE_SECTIONS = [
  '特征识别',
  '断语',
  '性格特质',
  '气度与格局',
  '状态提示',
  '发展建议',
] as const

function makeReport(injected = '', sections: readonly string[] = SAMPLE_SECTIONS): string {
  const filler = '三停比例大体匀称，传统相法认为这类格局的人一生节奏相对平稳，做事有自己的分寸。'
  return sections
    .map((s) => {
      const body = s === '性格特质' ? `${injected}${filler.repeat(4)}` : filler.repeat(4)
      return `## ${s}\n\n${body}`
    })
    .join('\n\n')
}

const unavailable: UnavailableItem[] = [
  { id: 'face.ear', label: '耳相', reason: 'not_observable', detail: '正面照拍不到' },
]

describe('结构校验', () => {
  it('核心段齐全的报告通过', () => {
    const r = guardReport(makeReport(), unavailable)
    expect(r.shouldRegenerate).toBe(false)
    for (const s of CORE_SECTIONS) expect(r.text).toContain(`## ${s}`)
  })

  it('缺核心段触发重生成', () => {
    const partial = makeReport().replace('## 发展建议', '## 其他')
    const r = guardReport(partial, unavailable)
    expect(r.shouldRegenerate).toBe(true)
    expect(r.hits.some((h) => h.category === 'structure')).toBe(true)
  })

  it('给了提纲就按提纲逐段核对 —— 提纲里的专题段缺了也算缺', () => {
    const sections = [...SAMPLE_SECTIONS, '财帛与积累']
    // 报告只写了 SAMPLE_SECTIONS，少了提纲要求的「财帛与积累」
    const r = guardReport(makeReport(), unavailable, { sections })
    expect(r.shouldRegenerate).toBe(true)
    expect(r.hits.some((h) => h.token.includes('财帛与积累'))).toBe(true)
  })

  it('提纲之外的段落被剔除，即使它在总白名单里', () => {
    // 「运势节奏」是合法标题，但本次提纲没要它 —— 模型自己加回来就该剔掉
    const withExtra = makeReport() + '\n\n## 运势节奏\n\n早年平顺，中年渐入佳境。'
    const r = guardReport(withExtra, unavailable, { sections: SAMPLE_SECTIONS })
    expect(r.text).not.toContain('## 运势节奏')
  })

  it('不给提纲时（追问、历史重放）旧七段式仍然合法', () => {
    const legacy = makeReport('', ['特征识别', '断语', '性格特质', '能力倾向', '运势倾向', '状态提示', '发展建议'])
    const r = guardReport(legacy, unavailable)
    expect(r.shouldRegenerate).toBe(false)
    expect(r.text).toContain('## 能力倾向')
  })

  it('段数越界触发重生成', () => {
    const tooFew = makeReport('', ['特征识别', '断语'])
    expect(guardReport(tooFew, unavailable).shouldRegenerate).toBe(true)
  })

  it('白名单外的小节被剔除', () => {
    const extra = `${makeReport()}\n\n## 开运建议\n\n买个手串戴上就好了。`
    const r = guardReport(extra, unavailable)
    expect(r.text).not.toContain('开运建议')
    expect(r.text).not.toContain('手串')
  })

  it('剥掉模型自作主张包上的代码块', () => {
    const fenced = '```markdown\n' + makeReport() + '\n```'
    const r = guardReport(fenced, unavailable)
    expect(r.text.startsWith('## 特征识别')).toBe(true)
  })

  it('过短触发重生成', () => {
    const short = SAMPLE_SECTIONS.map((s) => `## ${s}\n\n简。`).join('\n\n')
    expect(guardReport(short, unavailable).shouldRegenerate).toBe(true)
  })
})

describe('内容过滤 —— 直接删句的类别', () => {
  const cases: [string, string][] = [
    ['寿夭断言', '耳小薄削者主短命，需要格外注意。'],
    ['克夫克妻', '这样的面相容易克夫，婚姻上要当心。'],
    ['疾病诊断', '气色发黄说明肝胆有问题，建议尽快就医检查。'],
    ['身材歧视', '矮个子的人格局有限，难成大事。'],
    ['性别刻板', '女命主旺夫，宜嫁得早一些。'],
    ['具体时间预测', '明年三月会有一次重要的事业机遇。'],
  ]

  for (const [name, sentence] of cases) {
    it(`${name}被删除`, () => {
      const r = finalizeReport(makeReport(sentence), unavailable)
      // 取被删句子里最有代表性的一段来断言
      const marker = sentence.slice(2, 8)
      expect(r.text).not.toContain(marker)
      expect(r.stripped).toBeGreaterThan(0)
    })
  }

  it('删句不会破坏其余内容', () => {
    const r = finalizeReport(makeReport('这样的面相容易克夫。'), unavailable)
    expect(r.text).toContain('三停比例大体匀称')
    for (const s of CORE_SECTIONS) expect(r.text).toContain(`## ${s}`)
  })
})

/**
 * 2026-08：内容边界收窄到四条硬边界（docs/07 第一节）。
 * 传统相书的性格断语与断定口气不再拦 —— 这是本 App 要呈现的东西，
 * 拦掉它等于把相术的判断力删掉。
 */
describe('传统断语放行', () => {
  const kept: [string, string][] = [
    ['人格断语', '三白眼，传统列为忌相，主薄情寡义、六亲缘浅。'],
    ['城府心机', '目光藏而不露，此相传统主城府较深、心事不轻示人。'],
    ['性情急躁', '眉浓而逆，传统主性情急躁、气盛易与人争。'],
    ['忌相与断定口气', '山根低陷，古法列为中年之忌，主意志易摇，必仗外力方能成事。'],
    ['六亲缘薄', '人中浅短，传统主六亲缘薄、晚景少依。'],
  ]

  for (const [name, sentence] of kept) {
    it(`${name}被保留`, () => {
      const r = finalizeReport(makeReport(sentence), unavailable)
      expect(r.text).toContain(sentence)
    })
  }

  it('不再因为措辞触发重生成', () => {
    const r = guardReport(makeReport('此相必主心机较深，六亲缘薄。'), unavailable)
    expect(r.shouldRegenerate).toBe(false)
    expect(r.hits.filter((h) => h.action === 'regenerate')).toHaveLength(0)
  })

  it('放行性格断语，但同句里的疾病指向照删', () => {
    const r = finalizeReport(makeReport('此人城府较深。气色晦滞说明肝胆有问题。'), unavailable)
    expect(r.text).toContain('城府较深')
    expect(r.text).not.toContain('肝胆')
  })
})

describe('unavailable 泄漏', () => {
  it('对不可观测项下判断的句子被删', () => {
    const r = finalizeReport(makeReport('你的耳相厚实，主福泽绵长。'), unavailable)
    expect(r.text).not.toContain('耳相厚实')
  })

  it('如实说明「未观测」的句子被保留', () => {
    const honest = '其中耳相需要侧面照才能观测，本次无法获取，故不作论断。'
    const r = finalizeReport(makeReport(honest), unavailable)
    expect(r.text).toContain('不作论断')
  })
})

describe('JSON 字段名泄漏', () => {
  it('复述数据结构的句子被删', () => {
    const r = finalizeReport(makeReport('该特征的 confidence 为 0.52。'), unavailable)
    expect(r.text).not.toContain('confidence')
  })
})

describe('空节兜底', () => {
  it('内容被删光的小节换成如实说明，而不是留空标题', () => {
    const bad = SAMPLE_SECTIONS.map((s) =>
      s === '状态提示' ? `## ${s}\n\n气色发黄说明肝胆有问题。` : `## ${s}\n\n${'平稳匀称，节奏得当。'.repeat(8)}`,
    ).join('\n\n')
    const r = finalizeReport(bad, unavailable)
    expect(r.text).toContain('## 状态提示')
    expect(r.text).not.toContain('肝胆')
    expect(r.text).toContain('暂略')
  })
})

describe('追问前置检查', () => {
  it('普通问题放行', () => {
    expect(preflightQuestion('我适合做什么工作？').kind).toBe('ok')
  })

  it('危机关键词拦下 —— 这一轮不会发给 AI', () => {
    expect(preflightQuestion('我不想活了，看看我的命').kind).toBe('crisis')
  })

  it('重大人生决定被标记', () => {
    const v = preflightQuestion('我该不该离婚？')
    expect(v.kind).toBe('major_decision')
  })
})
