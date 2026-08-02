/**
 * AI 输出后置校验。渲染前必过。
 *
 * ⚠️ 只管内容，不管版式。
 * 早先这里还强制六个固定小节和 1000–1500 字，达不到就整篇重生成 ——
 * 用户看到的是「措辞不合规范，正在重新生成」，实际上文字并没有问题，
 * 只是没按模板写。那是把模板当成了安全要求，已经去掉：
 * 小节怎么分、写多长，交给模型自己拿捏。
 *
 * 留下的是真正的内容红线，处置分两档：
 *   regenerate —— 值得再要一次（措辞问题，模型通常改得掉）
 *   strip      —— 直接删句，不给第二次机会（涉及寿夭/疾病/污名，重生成有二次风险）
 */

import {
  BANNED_TIME_PREDICTION,
  CATEGORY_ACTION,
  CRISIS_KEYWORDS,
  MAJOR_DECISION_KEYWORDS,
  WORD_LISTS,
  type GuardCategory,
} from './guard.rules'
import type { UnavailableItem } from './types'

export interface GuardHit {
  category: GuardCategory
  /** 命中的词或说明，仅用于本地审计日志 —— 不含用户内容 */
  token: string
  action: 'regenerate' | 'strip'
}

export interface GuardResult {
  text: string
  hits: GuardHit[]
  /** 是否应当重新生成一次 */
  shouldRegenerate: boolean
  /** 被删除的句子数 */
  stripped: number
}

/** 中英文句子切分，保留标点 */
const SENTENCE_RE = /[^。！？；\n]+[。！？；]?/g

export function guardReport(
  raw: string,
  unavailable: UnavailableItem[] = [],
  opts: { allowRegenerate?: boolean } = {},
): GuardResult {
  const hits: GuardHit[] = []
  let text = raw.trim()

  // 有些模型会用代码块把 markdown 包起来，先剥掉
  text = text.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/m, '$1').trim()

  /* ---- 逐句过滤 ----
     只管内容安全（疾病论断、绝对化预测、对不可测项下结论等）。
     版式一概不管：小节叫什么、有几节、多长，都交给模型自己拿捏。 */
  const unavailableLabels = unavailable.map((u) => u.label).filter((l) => l.length >= 2)
  let stripped = 0

  const lines = text.split('\n')
  const kept: string[] = []

  for (const line of lines) {
    // 标题、分隔线、空行原样保留
    if (/^\s*(#{1,6}\s|---|\*\*\*|$)/.test(line)) {
      kept.push(line)
      continue
    }

    const sentences = line.match(SENTENCE_RE) ?? [line]
    const keptSentences: string[] = []

    for (const s of sentences) {
      const bad = scanSentence(s, unavailableLabels)
      if (!bad) {
        keptSentences.push(s)
        continue
      }
      hits.push(bad)
      if (bad.action === 'strip') {
        stripped++
      } else {
        // regenerate 类的先留着；若最终不重生成，第二遍会删掉
        keptSentences.push(s)
      }
    }

    const rebuilt = keptSentences.join('')
    // 整行被删空时，连列表符号一起去掉
    if (rebuilt.trim() && !/^\s*[-*·]\s*$/.test(rebuilt)) kept.push(rebuilt)
    else if (!sentences.length) kept.push(line)
  }

  text = kept.join('\n')

  const wantsRegen = hits.some((h) => h.action === 'regenerate')
  return {
    text: text.trim(),
    hits,
    shouldRegenerate: wantsRegen && opts.allowRegenerate !== false,
    stripped,
  }
}

/** 第二遍：不再重生成时，把 regenerate 类的句子也删掉 */
export function finalizeReport(raw: string, unavailable: UnavailableItem[] = []): GuardResult {
  const first = guardReport(raw, unavailable, { allowRegenerate: false })
  const labels = unavailable.map((u) => u.label).filter((l) => l.length >= 2)

  const lines = first.text.split('\n')
  const kept: string[] = []
  let stripped = first.stripped

  for (const line of lines) {
    if (/^\s*(#{1,6}\s|---|\*\*\*|$)/.test(line)) {
      kept.push(line)
      continue
    }
    const sentences = line.match(SENTENCE_RE) ?? [line]
    const ok = sentences.filter((s) => {
      const bad = scanSentence(s, labels)
      if (bad) stripped++
      return !bad
    })
    const rebuilt = ok.join('')
    if (rebuilt.trim() && !/^\s*[-*·]\s*$/.test(rebuilt)) kept.push(rebuilt)
  }

  return {
    text: kept.join('\n').trim(),
    hits: first.hits,
    shouldRegenerate: false,
    stripped,
  }
}

function scanSentence(s: string, unavailableLabels: string[]): GuardHit | null {
  for (const [category, words] of WORD_LISTS) {
    for (const w of words) {
      if (s.includes(w)) {
        return { category, token: w, action: CATEGORY_ACTION[category] }
      }
    }
  }
  if (BANNED_TIME_PREDICTION.test(s)) {
    return { category: 'time', token: '具体时间预测', action: CATEGORY_ACTION.time }
  }
  for (const label of unavailableLabels) {
    if (s.includes(label)) {
      // 「未观测」「无法获取」这类如实说明是允许的，只拦对不可测项的论断
      if (/未观测|无法|不作论断|没有获取|未采集|测不到/.test(s)) continue
      return { category: 'unavailable_leak', token: label, action: 'strip' }
    }
  }
  return null
}

/* ============================================================
   追问的前置检查 —— 在发请求给 AI 之前跑
   ============================================================ */

export type PreflightVerdict =
  | { kind: 'ok' }
  | { kind: 'crisis' }
  | { kind: 'major_decision'; keyword: string }

export function preflightQuestion(q: string): PreflightVerdict {
  for (const k of CRISIS_KEYWORDS) {
    if (q.includes(k)) return { kind: 'crisis' }
  }
  for (const k of MAJOR_DECISION_KEYWORDS) {
    if (q.includes(k)) return { kind: 'major_decision', keyword: k }
  }
  return { kind: 'ok' }
}
