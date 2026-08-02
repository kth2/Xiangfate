/**
 * 求测问答知识库的落地校验。
 * 对应 docs/xiangshu-qa-knowledge.md，重点是第 7 节那张冲突表：
 * 传统做法与内容策略打架的主题，必须带着 boundary 一起进 prompt。
 */

import { describe, expect, it } from 'vitest'
import { preflightQuestion } from '../guard'
import { BANNED_ABSOLUTE, BANNED_FATE, BANNED_GENDERED, BANNED_STIGMA } from '../guard.rules'
import { ANSWER_STRUCTURE, detectTopics, TOPIC_GUIDES, TOPIC_ORDER, TYPE_QA_NOTES } from '../qa'
import { PRESET_QUESTIONS, presetsFor } from '@/copy/questions.zh-CN'
import { buildFollowUpPrompt } from '@/prompts/user'
import { ALL_TYPES } from '../registry'
import type { AnalysisType } from '../types'

describe('主题判定', () => {
  const cases: [string, string][] = [
    ['我能不能赚到钱？', 'wealth'],
    ['事业上适合什么方向？', 'career'],
    ['我的感情该怎么经营？', 'relationship'],
    ['生命线短是不是短命？', 'health'],
    ['我有几个孩子？', 'children'],
    ['今年运气怎么样？什么时候转运？', 'timing'],
    ['我是什么性格？', 'personality'],
    ['我这一生整体格局怎么样？', 'overall'],
  ]

  it.each(cases)('「%s」判为 %s', (q, topic) => {
    expect(detectTopics(q)).toContain(topic)
  })

  it('没命中任何关键词时返回空，不硬凑主题', () => {
    expect(detectTopics('这份报告是怎么算出来的？')).toEqual([])
    expect(detectTopics('   ')).toEqual([])
  })

  it('多主题问题按 TOPIC_ORDER 排序', () => {
    const topics = detectTopics('我的性格适合什么工作？财运如何？')
    expect(topics).toEqual([...topics].sort((a, b) => TOPIC_ORDER.indexOf(a) - TOPIC_ORDER.indexOf(b)))
  })

  it('每个主题都在 TOPIC_ORDER 与 TOPIC_GUIDES 里各出现一次', () => {
    expect(new Set(TOPIC_ORDER).size).toBe(TOPIC_ORDER.length)
    expect([...TOPIC_ORDER].sort()).toEqual(Object.keys(TOPIC_GUIDES).sort())
  })
})

describe('高危主题必须带 boundary', () => {
  // 这几项在 docs/07 里被明确改写过，只给传统答法等于放模型按旧规矩答
  it.each(['health', 'relationship', 'children', 'timing', 'wealth'] as const)(
    '%s 有 boundary',
    (topic) => {
      expect(TOPIC_GUIDES[topic].boundary?.length ?? 0).toBeGreaterThan(10)
    },
  )
})

describe('预设问题', () => {
  const all = ALL_TYPES.flatMap((t) => PRESET_QUESTIONS[t])

  it('四类都有预设问题', () => {
    for (const t of ALL_TYPES) expect(presetsFor(t).length).toBeGreaterThanOrEqual(4)
  })

  it('id 唯一', () => {
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length)
  })

  it('topic 都是已定义的主题', () => {
    for (const p of all) expect(TOPIC_GUIDES[p.topic]).toBeDefined()
  })

  it('不会被前置检查拦下 —— 预设问题点了就该有回答', () => {
    for (const p of all) expect(preflightQuestion(p.text).kind).toBe('ok')
  })

  it('自身不含禁用词', () => {
    const banned = [...BANNED_ABSOLUTE, ...BANNED_FATE, ...BANNED_STIGMA, ...BANNED_GENDERED]
    for (const p of all) {
      for (const w of banned) expect(p.text).not.toContain(w)
    }
  })

  it('不问本项目不作论断的主题', () => {
    for (const p of all) expect(p.topic).not.toBe('children')
  })
})

describe('追问 prompt 注入', () => {
  const opts = (type: AnalysisType) => ({ type })

  it('注入命中主题的应对方向与本项目口径', () => {
    const p = buildFollowUpPrompt('我什么时候能发财？', 1, opts('mianxiang'))
    expect(p).toContain('传统应对方向')
    expect(p).toContain(TOPIC_GUIDES.wealth.approach)
    expect(p).toContain('本项目口径')
    expect(p).toContain(TOPIC_GUIDES.timing.boundary!)
  })

  it('未命中主题时不注入方向段，只留结构与类型提醒', () => {
    const p = buildFollowUpPrompt('这些数据是怎么测的？', 1, opts('tixiang'))
    expect(p).not.toContain('传统应对方向')
    expect(p).toContain(ANSWER_STRUCTURE[0])
  })

  it('按类型注入对应提醒', () => {
    const shou = buildFollowUpPrompt('生命线怎么看？', 1, opts('shouxiang'))
    expect(shou).toContain('生命线长短与寿命无关')
    expect(shou).not.toContain(TYPE_QA_NOTES.guxiang[1])

    const gu = buildFollowUpPrompt('我的骨相如何？', 1, opts('guxiang'))
    expect(gu).toContain('枕骨')
  })

  it('重大人生决定时追加慎重提示', () => {
    const q = '我该不该辞职？'
    expect(preflightQuestion(q).kind).toBe('major_decision')

    const p = buildFollowUpPrompt(q, 2, { type: 'mianxiang', majorDecision: true })
    expect(p).toContain('不该靠相术来定')
    expect(buildFollowUpPrompt(q, 2, opts('mianxiang'))).not.toContain('不该靠相术来定')
  })

  it('四类的提醒都非空', () => {
    for (const t of ALL_TYPES) expect(TYPE_QA_NOTES[t].length).toBeGreaterThan(0)
  })
})
