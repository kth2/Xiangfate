/**
 * guard 是唯一一道不依赖模型配合的防线，必须有硬测试。
 * 每一条用例都对应 docs/07-content-policy.md 里的一类问题内容。
 */

import { describe, expect, it } from 'vitest'
import { finalizeReport, guardReport, preflightQuestion } from '../guard'
import { REQUIRED_SECTIONS } from '../guard.rules'
import type { UnavailableItem } from '../types'

/** 造一份结构合法、长度达标的报告，把待测句子插进「性格特质」 */
function makeReport(injected = ''): string {
  const filler = '三停比例大体匀称，传统相法认为这类格局的人一生节奏相对平稳，做事有自己的分寸。'
  return REQUIRED_SECTIONS.map((s) => {
    const body = s === '性格特质' ? `${injected}${filler.repeat(4)}` : filler.repeat(4)
    return `## ${s}\n\n${body}`
  }).join('\n\n')
}

const unavailable: UnavailableItem[] = [
  { id: 'face.ear', label: '耳相', reason: 'not_observable', detail: '正面照拍不到' },
]

describe('结构校验', () => {
  it('六段齐全的报告通过', () => {
    const r = guardReport(makeReport(), unavailable)
    expect(r.shouldRegenerate).toBe(false)
    for (const s of REQUIRED_SECTIONS) expect(r.text).toContain(`## ${s}`)
  })

  it('缺小节触发重生成', () => {
    const partial = makeReport().replace('## 发展建议', '## 其他')
    const r = guardReport(partial, unavailable)
    expect(r.shouldRegenerate).toBe(true)
    expect(r.hits.some((h) => h.category === 'structure')).toBe(true)
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
    const short = REQUIRED_SECTIONS.map((s) => `## ${s}\n\n简。`).join('\n\n')
    expect(guardReport(short, unavailable).shouldRegenerate).toBe(true)
  })
})

describe('内容过滤 —— 直接删句的类别', () => {
  const cases: [string, string][] = [
    ['寿夭断言', '耳小薄削者主短命，需要格外注意。'],
    ['克夫克妻', '这样的面相容易克夫，婚姻上要当心。'],
    ['疾病诊断', '气色发黄说明肝胆有问题，建议尽快就医检查。'],
    ['人格污名', '此人心术不正，为人狡诈，不宜深交。'],
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
    for (const s of REQUIRED_SECTIONS) expect(r.text).toContain(`## ${s}`)
  })
})

describe('内容过滤 —— 触发重生成的类别', () => {
  it('绝对化措辞触发重生成', () => {
    const r = guardReport(makeReport('你注定会在中年之后大富大贵。'), unavailable)
    expect(r.shouldRegenerate).toBe(true)
    expect(r.hits.some((h) => h.category === 'absolute')).toBe(true)
  })

  it('不给第二次机会时绝对化措辞被删', () => {
    const r = finalizeReport(makeReport('你注定会在中年之后大富大贵。'), unavailable)
    expect(r.text).not.toContain('注定')
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
    const bad = REQUIRED_SECTIONS.map((s) =>
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
