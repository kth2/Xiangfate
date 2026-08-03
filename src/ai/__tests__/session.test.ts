/**
 * 追问链路的回归测试。
 *
 * 这几条都对应线上真实出现过的「点了没反应」：
 *   · 从往迹页重新提问时会话是空的 —— 第 4 轮起直接抛错
 *   · 短回答被 fillEmptySections 换成一句风马牛不相及的话
 * 界面那半边（错误从来不渲染）在 Report.tsx，这里覆盖不到，
 * 但只要这两条不回归，剩下的失败都能真正走到 catch 里被显示出来。
 */

import { describe, expect, it } from 'vitest'
import { AnalysisSession, type ResumeState } from '../session'
import type { AIProvider, ChatMessage } from '../provider'
import type { AnalysisEnvelope } from '@/core/types'

const ENV = {
  schemaVersion: '1.0.0',
  analysisType: 'mianxiang',
  analysisId: 'test',
  capturedAt: new Date().toISOString(),
  locale: 'zh-CN',
  capture: { shots: ['front'], quality: {} },
  features: [],
  derived: {},
  unavailable: [{ id: 'face.ear', label: '耳相', reason: 'not_observable', detail: '拍不到' }],
  scorecard: {},
  policy: { disclaimerRequired: true, forbidTopics: [] },
} as unknown as AnalysisEnvelope

/** 记录每次调用收到的 messages，并吐回预设文本 */
function fakeProvider(reply: string) {
  const calls: ChatMessage[][] = []
  const provider: AIProvider = {
    id: 'fake',
    model: 'fake',
    async *stream(messages) {
      calls.push(messages)
      yield reply
    },
  }
  return { provider, calls }
}

async function drain(gen: AsyncGenerator<{ done?: { text: string } }>): Promise<string> {
  let text = ''
  for await (const ev of gen) if (ev.done) text = ev.done.text
  return text
}

const RESUME: ResumeState = {
  report: '## 特征识别\n三停大体匀称。\n\n## 断语\n· 三停平均。',
  followUps: [{ question: '事业如何', answer: '中停丰隆，主中年主运。' }],
}

describe('从往迹页恢复会话', () => {
  it('带上 System Prompt、特征数据与既往问答', async () => {
    const { provider, calls } = fakeProvider('答案。')
    const s = new AnalysisSession(provider, ENV, RESUME)
    await drain(s.ask('那财运呢'))

    const msgs = calls[0]
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('证据锁定')
    expect(msgs[1].content).toContain('本次解读类型')
    expect(msgs[2].content).toBe(RESUME.report)
    // 既往问答也在，模型才接得上话
    expect(msgs.some((m) => m.content === '事业如何')).toBe(true)
  })

  it('轮次从既往问答接着数', async () => {
    const { provider } = fakeProvider('答案。')
    const s = new AnalysisSession(provider, ENV, RESUME)
    expect(s.turnCount).toBe(1)
    await drain(s.ask('再问一句'))
    expect(s.turnCount).toBe(2)
  })

  it('第 4 轮之后不再抛错 —— 这是原来那个静默失败的根因', async () => {
    const { provider, calls } = fakeProvider('答案。')
    // 没有 resume：history 为空，正是往迹页重建会话时的状态
    const s = new AnalysisSession(provider, ENV)
    for (let i = 0; i < 5; i++) {
      await expect(drain(s.ask(`第 ${i} 问`))).resolves.toBeTruthy()
    }
    expect(calls).toHaveLength(5)
  })
})

describe('追问回答的过滤', () => {
  it('短回答原样保留，不会被换成「暂略」', async () => {
    const short = '这一点本次测量没有覆盖。'
    const { provider } = fakeProvider(short)
    const s = new AnalysisSession(provider, ENV, RESUME)
    expect(await drain(s.ask('我耳朵怎么样'))).toBe(short)
  })

  it('不给追问套报告结构，也不补小节标题', async () => {
    const { provider } = fakeProvider('准头丰圆，主财帛有根。')
    const s = new AnalysisSession(provider, ENV, RESUME)
    const out = await drain(s.ask('财运'))
    expect(out).not.toContain('##')
    expect(out).not.toContain('暂略')
  })

  it('硬边界照删 —— 过滤放松的只是结构，不是内容', async () => {
    const { provider } = fakeProvider('气色发黄说明肝胆有问题。此外准头丰圆，主财帛有根。')
    const s = new AnalysisSession(provider, ENV, RESUME)
    const out = await drain(s.ask('健康'))
    expect(out).not.toContain('肝胆')
    expect(out).toContain('准头丰圆')
  })

  it('对不可观测项下判断的句子仍然删', async () => {
    const { provider } = fakeProvider('你的耳相厚实，主福泽绵长。准头丰圆，主财帛有根。')
    const s = new AnalysisSession(provider, ENV, RESUME)
    const out = await drain(s.ask('耳朵'))
    expect(out).not.toContain('耳相厚实')
    expect(out).toContain('准头丰圆')
  })
})

describe('危机词', () => {
  it('命中就不发给 AI', async () => {
    const { provider, calls } = fakeProvider('不该被调用')
    const s = new AnalysisSession(provider, ENV, RESUME)
    await expect(drain(s.ask('我不想活了'))).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})
