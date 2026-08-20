/**
 * 组合成象：把**多条特征之间的关系**判成传统相术里的「象」。
 *
 * ── 为什么要这一层 ────────────────────────────────────────
 * 在这一层之前，全部下判断的地方都是「一条特征 → 一句话」：
 * verdicts.ts 是 `TABLE[f.label]`，scorecard.ts 是 Σ(权重 × 档位偏移)。
 * 于是同一个鼻翼宽度永远只能得到同一句话。
 *
 * 但相师看的不是三十个互不相干的读数，而是关系：
 * 准头有肉配上鼻翼有收、山根连续，是「财有所承」；
 * 同样的准头，若鼻翼过张而山根低陷，古法反而作「取之有能而守之不足」论。
 * **同一个测量值，配不同的邻居，是两种象。** 这一层就是为了让这句话能表达。
 *
 * ── 与既有各层的分工 ──────────────────────────────────────
 * · 不碰星级。组合只产出文字之象，不进 scorecard —— 它建立在 face3d.* 之上，
 *   而那批阈值从未用真实人群校准过，不该拿去支撑一个用户会当成度量的数字。
 * · 不替代断语。verdicts 的 48 条单特征断语照旧，组合与它们并列。
 * · 原始 face3d 数值仍然不可引用：进 prompt 的证据链里，
 *   3D 环节只给定性要求，数字只留在 envelope 里供 UI 点开回溯。
 *
 * ⚠️ 本文件属于 src/core，只放纯数据与纯函数。
 */

import type { Band, Classic, FeatureItem } from './types'

/* ============================================================
   契约
   ============================================================ */

export type ConfigTone = 'gui' | 'ji' | 'neutral'

/** 象所属的人事范围。矛盾检测按域配对 —— 跨域的强弱不同不是矛盾，是侧重 */
export type ConfigDomain = '格局' | '财帛' | '情感' | '执行' | '根基' | '才智'

/**
 * 一条成立条件。
 *
 * `requirement` 是这条条件的人话，进证据链给用户看 ——
 * 条件不写人话就等于「因为代码说是」，那这一层的可追溯就白做了。
 */
export interface ConfigCondition {
  featureId: string
  /** 档位需属于其中之一。与 gte/lte 可同时给，都要满足 */
  bands?: Band[]
  gte?: number
  lte?: number
  requirement: string
}

export interface ConfigBranch {
  /** 象名，如「鼻有根而颧有辅」 */
  configuration: string
  tone: ConfigTone
  /** 全部条件成立才算命中 */
  when: ConfigCondition[]
  /** 象义。照相书原意写，不作好听的改写 */
  meaning: string
  /**
   * 同一个象里的反面。
   *
   * 传统相术几乎没有纯吉之象 —— 「权骨隆起」下一句就是「过显则好压人一头」。
   * 貴格分支给了 caution 才算写完。
   */
  caution?: string
}

export interface ConfigurationSpec {
  id: string
  /** 关系名，如「鼻颧关系」 */
  name: string
  domain: ConfigDomain
  source: Classic
  /**
   * 凭什么这么断 —— 必须能追到古法的说法。
   *
   * 这一条是硬要求：组合规则比单特征规则表达力强得多，也因此更容易过拟合。
   * 没有出处的组合就只是「我们希望这张脸读起来像这样」，
   * 那正是这一层最该避免的东西。
   */
  basis: string
  /** 参与判断的全部特征 id。缺一条就不判，而不是当它成立 */
  components: string[]
  /** 按顺序试，第一个条件全部成立的分支胜出 */
  branches: ConfigBranch[]
}

/* ============================================================
   结果
   ============================================================ */

/** 证据链的一环：这条条件要求什么、实测是什么 */
export interface EvidenceLink {
  featureId: string
  /** 传统术语 */
  label: string
  band: Band
  value: string | number
  /** 该特征自己的证据串（含数值） */
  evidence: string
  /** 这一环要求什么，人话 */
  requirement: string
  /** true = 该环是 3D 推导量，其数值不可进报告正文 */
  numeralRestricted: boolean
}

export interface DetectedConfiguration {
  id: string
  name: string
  domain: ConfigDomain
  /** 命中的象名 */
  configuration: string
  tone: ConfigTone
  meaning: string
  caution?: string
  source: Classic
  basis: string
  /**
   * 最弱一环的置信度。
   * 取 min 而不是均值 —— 一条链的可信度不会高于它最不确定的那一环。
   */
  confidence: number
  chain: EvidenceLink[]
}

export interface UnmetConfiguration {
  id: string
  name: string
  /** 'missing' = 所需特征本次没测到；'no_branch' = 测到了但不落任何一象 */
  reason: 'missing' | 'no_branch'
  detail: string
}

export interface Contradiction {
  domain: ConfigDomain
  /** 相互拉扯的两个象名 */
  between: [string, string]
  /** 一句话点出张力所在 */
  tension: string
}

export interface ConfigurationResult {
  detected: DetectedConfiguration[]
  unmet: UnmetConfiguration[]
  contradictions: Contradiction[]
}

/* ============================================================
   判定
   ============================================================ */

/** 3D 推导量：数值不可引用（见文件头） */
const isNumeralRestricted = (featureId: string): boolean => featureId.startsWith('face3d.')

function satisfies(cond: ConfigCondition, f: FeatureItem): boolean {
  if (cond.bands && !cond.bands.includes(f.band)) return false
  if (cond.gte !== undefined || cond.lte !== undefined) {
    const n = typeof f.value === 'number' ? f.value : Number(f.value)
    if (!Number.isFinite(n)) return false
    if (cond.gte !== undefined && n < cond.gte) return false
    if (cond.lte !== undefined && n > cond.lte) return false
  }
  return true
}

function link(cond: ConfigCondition, f: FeatureItem): EvidenceLink {
  return {
    featureId: f.id,
    label: f.label,
    band: f.band,
    value: f.value,
    evidence: f.evidence,
    requirement: cond.requirement,
    numeralRestricted: isNumeralRestricted(f.id),
  }
}

/**
 * 逐条组合判定。
 *
 * 纯函数、确定性：同一组特征永远给同一组象 —— 与星级、提纲同一个原则。
 */
export function detectConfigurations(
  features: FeatureItem[],
  specs: readonly ConfigurationSpec[],
): ConfigurationResult {
  const byId = new Map(features.map((f) => [f.id, f]))
  const detected: DetectedConfiguration[] = []
  const unmet: UnmetConfiguration[] = []

  for (const spec of specs) {
    const missing = spec.components.filter((id) => !byId.has(id))
    if (missing.length) {
      // 缺一条就不判 —— 「测得到才说」在组合这一层同样成立
      unmet.push({
        id: spec.id,
        name: spec.name,
        reason: 'missing',
        detail: `本次未测到 ${missing.length} 项所需特征，故不论此象`,
      })
      continue
    }

    const hit = spec.branches.find((b) =>
      b.when.every((c) => {
        const f = byId.get(c.featureId)
        return f ? satisfies(c, f) : false
      }),
    )

    if (!hit) {
      unmet.push({
        id: spec.id,
        name: spec.name,
        reason: 'no_branch',
        detail: '各项测到了，但组合关系不落任何一象 —— 属寻常，不另立论',
      })
      continue
    }

    const chain = hit.when.map((c) => link(c, byId.get(c.featureId)!))
    detected.push({
      id: spec.id,
      name: spec.name,
      domain: spec.domain,
      configuration: hit.configuration,
      tone: hit.tone,
      meaning: hit.meaning,
      ...(hit.caution ? { caution: hit.caution } : {}),
      source: spec.source,
      basis: spec.basis,
      confidence: Math.min(...chain.map((l) => byId.get(l.featureId)!.confidence)),
      chain,
    })
  }

  return { detected, unmet, contradictions: findContradictions(detected) }
}

/**
 * 矛盾检测。
 *
 * 同一域里同时出现貴象与忌象 —— **两者都保留**，不合并、不抵消。
 * 真实的脸本来就不是全好或全坏；把张力平均掉正是星级卡的毛病
 * （「财帛：强、守成：弱」被压成一个 4 星）。这里把它显式说出来，
 * 报告里才有「取之有能而守之不足」这种话可讲。
 */
export function findContradictions(
  detected: readonly DetectedConfiguration[],
): Contradiction[] {
  const out: Contradiction[] = []
  for (let i = 0; i < detected.length; i++) {
    for (let j = i + 1; j < detected.length; j++) {
      const a = detected[i]
      const b = detected[j]
      if (a.domain !== b.domain) continue
      const opposed =
        (a.tone === 'gui' && b.tone === 'ji') || (a.tone === 'ji' && b.tone === 'gui')
      if (!opposed) continue
      const gui = a.tone === 'gui' ? a : b
      const ji = a.tone === 'gui' ? b : a
      out.push({
        domain: a.domain,
        between: [gui.configuration, ji.configuration],
        tension: `同属${a.domain}，一有所成而一有所欠：${gui.configuration}与${ji.configuration}并见，须两边分开讲，不可相抵`,
      })
    }
  }
  return out
}

/* ============================================================
   给 prompt 的渲染
   ============================================================ */

/**
 * 证据链渲染成文本。
 *
 * **3D 环节只给定性要求，不给数字** —— 这是「原始 face3d 数值不可引用」的
 * 结构性保证：模型拿不到那些数字，就不可能引用它们。
 * 完整数值仍在 envelope 里，供 UI 点开逐层回溯。
 */
export function renderChain(chain: readonly EvidenceLink[]): string[] {
  return chain.map((l) =>
    l.numeralRestricted
      ? `    · ${l.label}：${l.requirement}（三维推导，此处不列数值）`
      : `    · ${l.label}：${l.requirement} —— ${l.evidence}`,
  )
}

/** 组合段的 prompt 文本。为空时也要给一句，避免模型自由发挥 */
export function configurationBlock(result: ConfigurationResult): string {
  const { detected, contradictions } = result
  if (!detected.length) {
    return `【本次成象 —— 由组合规则算出，不是你选的】
无。本次各部位之间未构成任何有名目的组合之象。
**不要**自己凑一个象出来 —— 各部位分开讲即可。`
  }

  const blocks = detected.map((d) => {
    const head = `  ${d.tone === 'ji' ? '【忌】' : d.tone === 'gui' ? '【贵】' : '【平】'}${d.name} · ${d.configuration}`
    const lines = [
      head,
      `    象义：${d.meaning}`,
      ...(d.caution ? [`    反面：${d.caution}`] : []),
      `    出处：《${d.source}》—— ${d.basis}`,
      `    凭据：`,
      ...renderChain(d.chain),
    ]
    return lines.join('\n')
  })

  const tension = contradictions.length
    ? `\n\n【并见的张力 —— 必须两边都讲，不可相抵】\n${contradictions
        .map((c) => `  · ${c.tension}`)
        .join('\n')}\n这几处是这张脸最值得说的地方：不要为了让报告顺畅而把它们平均掉。`
    : ''

  return `【本次成象 —— 由组合规则算出，不是你选的】
${blocks.join('\n\n')}${tension}

组合段的写法：
  1. 上面每一象都要写到，用象名起头，展开时落在「凭据」列的那几项上。
  2. **不要增补**表上没有的象。相邻部位之间的关系测到什么算什么。
  3. 标了「三维推导，此处不列数值」的环节：可以说它成立，**不得编造数字**。
  4. 有「反面」的，正面讲完要把反面带一句 —— 传统相术几乎没有纯吉之象。`
}
