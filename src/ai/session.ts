/**
 * 分析会话：报告生成 + 多轮追问 + 后置校验编排。
 *
 * 关键设计：guard 在这一层收口。调用方拿到的永远是**已经过滤过的**文本，
 * 不存在「忘了跑 guard」的可能。
 */

import {
  filterSentences,
  finalizeReport,
  guardReport,
  preflightQuestion,
  type GuardHit,
} from '@/core/guard'
import type { AnalysisEnvelope } from '@/core/types'
import { buildOutline } from '@/core/outline'
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

/** 从历史记录恢复会话时要带上的东西 */
export interface ResumeState {
  report: string
  followUps: { question: string; answer: string }[]
}

export class AnalysisSession {
  private readonly provider: AIProvider
  private readonly envelope: AnalysisEnvelope
  private history: ChatMessage[] = []
  private report = ''
  private turn = 0

  /**
   * @param resume 从往迹页打开旧报告再追问时传入。
   *
   * 不传会怎样 —— 早先就是不传：history 是空的，于是追问只发出去一条孤零零的
   * user 消息，既没有 System Prompt 也没有特征数据，而追问模板里还写着
   * 「仍然只能基于上面那份特征数据立论」。第 4 轮起更糟：
   * buildFollowUpContext 会解构空数组，firstAssistant 是 undefined，直接抛错。
   */
  constructor(provider: AIProvider, envelope: AnalysisEnvelope, resume?: ResumeState) {
    this.provider = provider
    this.envelope = envelope

    if (resume) {
      this.report = resume.report
      this.history = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(envelope) },
        { role: 'assistant', content: resume.report },
      ]
      for (const f of resume.followUps) {
        this.history.push(
          { role: 'user', content: f.question },
          { role: 'assistant', content: f.answer },
        )
      }
      this.turn = resume.followUps.length
    }
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
    // 与 buildUserPrompt 里算的是同一份提纲（纯函数、同一输入），
    // guard 因此能逐段核对本次实际要求的标题，而不是一张写死的清单
    const outline = buildOutline(
      this.envelope.features,
      this.envelope.subject?.focusTopics?.filter(Boolean) ?? [],
    )
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

    let result = guardReport(raw, this.envelope.unavailable, { sections: outline.sections })
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
      result = finalizeReport(raw2, this.envelope.unavailable, outline.sections)
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

    // 追问不检查报告的分段结构，只做内容过滤
    const filtered = filterFollowUp(raw, this.envelope)
    this.history.push({ role: 'user', content: question }, { role: 'assistant', content: filtered.text })

    yield { done: { text: filtered.text, hits: filtered.hits, regenerated: false } }
  }

  private buildFollowUpContext(question: string, majorDecision: boolean): ChatMessage[] {
    const followUp = buildFollowUpPrompt(question, this.turn, {
      type: this.envelope.analysisType,
      majorDecision,
    })

    // history 不足三条（没跑过报告、也没 resume）时不能走摘要分支 —— 会解构出 undefined
    if (this.turn <= SUMMARIZE_AFTER_TURN || this.history.length < 3) {
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

/** 追问的过滤：只做逐句内容扫描，不套报告结构，也不补空节 */
function filterFollowUp(raw: string, env: AnalysisEnvelope): { text: string; hits: GuardHit[] } {
  const r = filterSentences(raw, env.unavailable)
  return { text: r.text, hits: r.hits }
}

function describeHit(h: GuardHit): string {
  switch (h.category) {
    case 'structure':
      return h.token.startsWith('缺少')
        ? `${h.token}，六个二级标题必须齐全且顺序固定`
        : h.token.startsWith('过短')
          ? '全文过短，请按各段字数要求展开到 1100–1700 字'
          : h.token.startsWith('过长')
            ? '全文过长，请压缩到 1500 字以内'
            : `${h.token}，不要写白名单以外的小节`
    default:
      return `出现了不合规内容（${h.category}）`
  }
}
