/**
 * 分析会话：报告生成 + 多轮追问 + 后置校验编排。
 *
 * 关键设计：guard 在这一层收口。调用方拿到的永远是**已经过滤过的**文本，
 * 不存在「忘了跑 guard」的可能。
 */

import { finalizeReport, guardReport, preflightQuestion, type GuardHit } from '@/core/guard'
import type { AnalysisEnvelope } from '@/core/types'
import { correctionNote, SYSTEM_PROMPT } from '@/prompts/system'
import { buildFollowUpPrompt, buildUserPrompt, summarizeReport } from '@/prompts/user'
import { createGeminiProvider } from './gemini'
import { createOpenRouterProvider } from './openrouter'
import type { AIProvider, ChatMessage } from './provider'

export function createProvider(
  id: string,
  apiKey: string,
  model: string,
  baseUrl?: string,
): AIProvider {
  if (!apiKey.trim()) {
    throw new Error('还没配置 API Key，先去设置页填一个')
  }
  if (!model.trim()) {
    throw new Error('还没选模型，去设置页挑一个')
  }
  return id === 'openrouter'
    ? createOpenRouterProvider(apiKey, model, baseUrl)
    : createGeminiProvider(apiKey, model, baseUrl)
}

export interface StreamEvent {
  /** 增量文本（未过滤，仅供流式预览） */
  delta?: string
  /** 生成结束，text 是过滤后的最终文本 */
  done?: { text: string; hits: GuardHit[]; regenerated: boolean }
  /** 正在重新生成 */
  regenerating?: string[]
}

/** 从第 4 轮起把首份报告压成摘要，控制上下文 */
const SUMMARIZE_AFTER_TURN = 3

export class AnalysisSession {
  private readonly provider: AIProvider
  private readonly envelope: AnalysisEnvelope
  private history: ChatMessage[] = []
  private report = ''
  private turn = 0

  constructor(provider: AIProvider, envelope: AnalysisEnvelope) {
    this.provider = provider
    this.envelope = envelope
  }

  get reportText(): string {
    return this.report
  }

  get turnCount(): number {
    return this.turn
  }

  /**
   * 生成首份报告。
   * 流式 yield 增量供 UI 渲染；结束时给出经过 guard 的最终文本。
   * 若 guard 判定需要重生成，最多再试一次，第二次一律用 finalize（删句不重试）。
   */
  async *generateReport(signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const userPrompt = buildUserPrompt(this.envelope)
    const base: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]

    let raw = ''
    for await (const d of this.provider.stream(base, {
      temperature: 0.7,
      maxOutputTokens: 2048,
      signal,
    })) {
      raw += d
      yield { delta: d }
    }

    let result = guardReport(raw, this.envelope.unavailable)
    let regenerated = false

    if (result.shouldRegenerate) {
      const reasons = [...new Set(result.hits.filter((h) => h.action === 'regenerate').map(describeHit))]
      yield { regenerating: reasons }

      const retry: ChatMessage[] = [
        ...base,
        { role: 'assistant', content: raw },
        { role: 'user', content: correctionNote(reasons) },
      ]

      let raw2 = ''
      for await (const d of this.provider.stream(retry, {
        temperature: 0.6,
        maxOutputTokens: 2048,
        signal,
      })) {
        raw2 += d
      }
      // 第二次不再给机会：残留的问题句直接删
      result = finalizeReport(raw2, this.envelope.unavailable)
      raw = raw2
      regenerated = true
    }

    this.report = result.text
    this.history = [...base, { role: 'assistant', content: result.text }]

    yield { done: { text: result.text, hits: result.hits, regenerated } }
  }

  /**
   * 追问。
   * @returns null 表示被前置检查拦下（危机关键词），调用方应展示关怀卡片
   */
  async *ask(question: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const verdict = preflightQuestion(question)
    if (verdict.kind === 'crisis') {
      // 这一轮**不发给 AI**
      throw new CrisisInterrupt()
    }

    this.turn++
    const msgs = this.buildFollowUpContext(question, verdict.kind === 'major_decision')

    let raw = ''
    for await (const d of this.provider.stream(msgs, {
      temperature: 0.5,
      maxOutputTokens: 1024,
      signal,
    })) {
      raw += d
      yield { delta: d }
    }

    // 追问不检查六段式结构，只做内容过滤
    const filtered = filterFollowUp(raw, this.envelope)
    this.history.push({ role: 'user', content: question }, { role: 'assistant', content: filtered.text })

    yield { done: { text: filtered.text, hits: filtered.hits, regenerated: false } }
  }

  private buildFollowUpContext(question: string, majorDecision: boolean): ChatMessage[] {
    const followUp = buildFollowUpPrompt(question, this.turn, {
      type: this.envelope.analysisType,
      majorDecision,
    })

    if (this.turn <= SUMMARIZE_AFTER_TURN) {
      return [...this.history, { role: 'user', content: followUp }]
    }

    // 长会话：把首份报告换成本地摘要，其余轮次保留
    const [sys, firstUser, firstAssistant, ...tail] = this.history
    return [
      sys,
      firstUser,
      { role: 'assistant', content: `（首份报告摘要）${summarizeReport(firstAssistant.content)}` },
      ...tail,
      { role: 'user', content: followUp },
    ]
  }
}

export class CrisisInterrupt extends Error {
  constructor() {
    super('crisis')
    this.name = 'CrisisInterrupt'
  }
}

/** 追问的过滤：复用逐句扫描，但不要求六段式结构 */
function filterFollowUp(raw: string, env: AnalysisEnvelope): { text: string; hits: GuardHit[] } {
  // 包一层假的结构，跑完整 finalize 后再剥掉 —— 避免重复实现逐句逻辑
  const wrapped = `## 特征识别\n${raw.trim()}`
  const r = finalizeReport(wrapped, env.unavailable)
  const text = r.text.replace(/^##\s+特征识别\s*\n?/, '').trim()
  return { text, hits: r.hits }
}

function describeHit(h: GuardHit): string {
  switch (h.category) {
    case 'structure':
      return h.token.startsWith('缺少')
        ? `${h.token}，六个二级标题必须齐全且顺序固定`
        : h.token.startsWith('过短')
          ? '全文过短，请按各段字数要求展开到 1000–1500 字'
          : h.token.startsWith('过长')
            ? '全文过长，请压缩到 1500 字以内'
            : `${h.token}，不要写白名单以外的小节`
    default:
      return `出现了不合规内容（${h.category}）`
  }
}
