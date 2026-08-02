/**
 * guard 是唯一一道不依赖模型配合的防线，必须有硬测试。
 * 每一条用例都对应 docs/07-content-policy.md 里的一类问题内容。
 */

import { describe, expect, it } from 'vitest'
import { finalizeReport, guardReport, preflightQuestion } from '../guard'
import type { UnavailableItem } from '../types'

/**
 * 造一份报告，把待测句子插进正文。
 *
 * 版式故意写得随意 —— guard 已经不管小节名、节数和长度了，
 * 这些用例只该因为「内容」通过或失败，不该因为「格式」。
 */
function makeReport(injected = ''): string {
  const filler = '三停比例大体匀称，传统相法认为这类格局的人一生节奏相对平稳，做事有自己的分寸。'
  return `## 先说测到了什么\n\n${filler}\n\n### 性情\n\n${injected}${filler}\n\n随手一段没有标题的话。${filler}`
}

const unavailable: UnavailableItem[] = [
  { id: 'face.ear', label: '耳相', reason: 'not_observable', detail: '正面照拍不到' },
]

describe('版式不再受限 —— 用户明确要求让模型自由发挥', () => {
  it('自定小节名、自定节数的报告照过', () => {
    const r = guardReport(makeReport(), unavailable)
    expect(r.shouldRegenerate).toBe(false)
    expect(r.hits).toEqual([])
    expect(r.text).toContain('## 先说测到了什么')
    expect(r.text).toContain('### 性情')
  })

  it('完全没有标题也照过', () => {
    const r = guardReport('三停匀称，做事有分寸。行文平实，不分小节。', unavailable)
    expect(r.shouldRegenerate).toBe(false)
    expect(r.hits).toEqual([])
  })

  it('很短的报告不再触发重生成', () => {
    // 旧规则要求 500 字起，达不到就整篇重来 —— 用户看到的就是那句
    // 「全文过短，请按各段字数要求展开到 1000–1500 字」
    const r = guardReport('三停匀称。', unavailable)
    expect(r.shouldRegenerate).toBe(false)
    expect(r.hits).toEqual([])
  })

  it('很长的报告也不再触发重生成', () => {
    const r = guardReport('三停匀称，做事有分寸。'.repeat(400), unavailable)
    expect(r.shouldRegenerate).toBe(false)
  })

  it('模型自拟的小节标题不会被剔除', () => {
    const r = guardReport(`${makeReport()}\n\n## 几点可以留意的方向\n\n作息规律些。`, unavailable)
    expect(r.text).toContain('几点可以留意的方向')
  })

  it('内容违规仍然照拦 —— 放开的是版式，不是红线', () => {
    const r = guardReport('三停匀称。你注定会大富大贵。', unavailable)
    expect(r.shouldRegenerate).toBe(true)
    expect(r.hits.some((h) => h.category === 'absolute')).toBe(true)
  })

  it('剥掉模型自作主张包上的代码块', () => {
    const fenced = '```markdown\n' + makeReport() + '\n```'
    const r = guardReport(fenced, unavailable)
    expect(r.text.startsWith('## 先说测到了什么')).toBe(true)
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

  it('删句不会破坏其余内容与标题', () => {
    const r = finalizeReport(makeReport('这样的面相容易克夫。'), unavailable)
    expect(r.text).toContain('三停比例大体匀称')
    expect(r.text).toContain('## 先说测到了什么')
    expect(r.text).toContain('### 性情')
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
