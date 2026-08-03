/**
 * AI 输出后置校验。渲染前必过。
 *
 * 处置分两档：
 *   regenerate —— 值得再要一次（措辞问题，模型通常改得掉）
 *   strip      —— 直接删句，不给第二次机会（涉及寿夭/疾病/污名，重生成有二次风险）
 *
 * 删句后若某小节内容过短，整节替换为一句实话，而不是留个空标题。
 */

import {
  BANNED_TIME_PREDICTION,
  CATEGORY_ACTION,
  CRISIS_KEYWORDS,
  LENGTH,
  MAJOR_DECISION_KEYWORDS,
  REQUIRED_SECTIONS,
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

const SECTION_RE = /^##\s+(.+?)\s*$/gm
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

  /* ---- 结构检查 ---- */
  const found = [...text.matchAll(SECTION_RE)].map((m) => m[1].trim())
  const missing = REQUIRED_SECTIONS.filter((s) => !found.includes(s))
  if (missing.length) {
    hits.push({ category: 'structure', token: `缺少小节 ${missing.join('/')}`, action: 'regenerate' })
  }
  // 白名单外的小节直接剔除
  const extras = found.filter((s) => !(REQUIRED_SECTIONS as readonly string[]).includes(s))
  for (const extra of extras) {
    text = removeSection(text, extra)
    hits.push({ category: 'structure', token: `多余小节 ${extra}`, action: 'strip' })
  }

  /* ---- 逐句过滤 ---- */
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

  /* ---- 长度 ---- */
  const len = text.replace(/\s/g, '').length
  if (len < LENGTH.min) {
    hits.push({ category: 'structure', token: `过短 ${len} 字`, action: 'regenerate' })
  } else if (len > LENGTH.max) {
    hits.push({ category: 'structure', token: `过长 ${len} 字`, action: 'regenerate' })
  }

  /* ---- 空节兜底 ---- */
  text = fillEmptySections(text)

  const wantsRegen = hits.some((h) => h.action === 'regenerate')
  return {
    text: text.trim(),
    hits,
    shouldRegenerate: wantsRegen && opts.allowRegenerate !== false,
    stripped,
  }
}

/**
 * 只做逐句内容过滤，不碰结构、不补空节。
 *
 * 追问回答走这条路：它本来就没有六/七段式结构，
 * 早先的做法是把答案包成一个假的「## 特征识别」再跑整套 finalizeReport，
 * 结果 fillEmptySections 会把不足 50 字的答案整段换成
 * 「（本次测得的特征不足以就这一部分展开，暂略。）」——
 * 于是「这一点本次测量没有覆盖」这种正确且必要的短回答，
 * 到用户眼前就变成了一句风马牛不相及的话。
 */
export function filterSentences(
  raw: string,
  unavailable: UnavailableItem[] = [],
): { text: string; hits: GuardHit[]; stripped: number } {
  const labels = unavailable.map((u) => u.label).filter((l) => l.length >= 2)
  const hits: GuardHit[] = []
  let stripped = 0
  const kept: string[] = []

  for (const line of raw.trim().split('\n')) {
    if (/^\s*(#{1,6}\s|---|\*\*\*|$)/.test(line)) {
      kept.push(line)
      continue
    }
    const sentences = line.match(SENTENCE_RE) ?? [line]
    const ok = sentences.filter((s) => {
      const bad = scanSentence(s, labels)
      if (bad) {
        hits.push(bad)
        stripped++
      }
      return !bad
    })
    const rebuilt = ok.join('')
    if (rebuilt.trim() && !/^\s*[-*·]\s*$/.test(rebuilt)) kept.push(rebuilt)
  }

  return { text: kept.join('\n').trim(), hits, stripped }
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
    text: fillEmptySections(kept.join('\n')).trim(),
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

/**
 * 整节删除。用切分而不是正则 —— JS 没有 \z 锚点，
 * 「匹配到下一个 ## 或字符串结尾」用正则写很容易出边界 bug。
 */
function removeSection(text: string, heading: string): string {
  return text
    .split(/(?=^##\s)/m)
    .filter((part) => {
      if (!part.startsWith('##')) return true
      const nl = part.indexOf('\n')
      const title = part.slice(2, nl > 0 ? nl : undefined).trim()
      return title !== heading
    })
    .join('')
}

const EMPTY_NOTE = '（本次测得的特征不足以就这一部分展开，暂略。）'

function fillEmptySections(text: string): string {
  const parts = text.split(/(?=^##\s)/m)
  return parts
    .map((part) => {
      if (!part.startsWith('##')) return part
      const nl = part.indexOf('\n')
      if (nl < 0) return `${part}\n\n${EMPTY_NOTE}\n`
      const body = part.slice(nl).replace(/\s/g, '')
      return body.length < 50 ? `${part.slice(0, nl)}\n\n${EMPTY_NOTE}\n` : part
    })
    .join('')
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
