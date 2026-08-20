/**
 * 报告提纲：**这一份报告该有哪几段，由这个人测到了什么决定。**
 *
 * 为什么要有这一层 ——
 * 原来的 System Prompt 写死七个二级标题、顺序固定、每段还各给一个字数区间。
 * 于是无论测到什么，模型都得把同一张骨架填满：一个人本次只在田宅宫与感情线
 * 上有名堂，照样要凑出一段「能力倾向」。差异化审计量到的结果是
 * 「两个明显不同的人，模型收到的输入只有 14% 不同」——
 * 剩下 86% 里最要紧的就是这张骨架。
 *
 * 现在改成：**骨架也是算出来的。**
 * 固定段只留承担内容义务的那几段（特征识别、断语、状态提示、发展建议），
 * 其余按本次测到的东西挑 2–4 段专题。挑选是确定性的查表 + 排序，不经模型 ——
 * 与星级同一个原则：同一张照片必须每次得到同一份提纲。
 *
 * ⚠️ 本文件属于 src/core，只放纯数据与纯函数。
 */

import { isEvidenceOnly } from './evidenceOnly'
import type { Band, FeatureItem } from './types'

/* ============================================================
   显著度
   ============================================================ */

/**
 * 档位的「值得一说」程度。
 *
 * 中和不是没信息，但它是**默认**：传统相术以中和为常，偏离才是话题。
 * categorical 居中 —— 五形、脸型、手型这类分类项本身就是一句判断。
 */
const BAND_SALIENCE: Record<Band, number> = {
  very_low: 1,
  very_high: 1,
  low: 0.65,
  high: 0.65,
  categorical: 0.4,
  balanced: 0.1,
}

export interface SalientFeature {
  id: string
  label: string
  band: Band
  value: string | number
  confidence: number
  evidence: string
  /** 显著度 = 档位显著度 × 置信度 */
  salience: number
}

/**
 * 按「这一项对这个人来说有多反常」排序。
 *
 * 只作数值依据的项（core/evidenceOnly）不参与 —— 它们连判断都不下，
 * 更不该决定报告写什么。
 */
export function rankSalience(features: FeatureItem[]): SalientFeature[] {
  return features
    .filter((f) => !isEvidenceOnly(f.id))
    .map((f) => ({
      id: f.id,
      label: f.label,
      band: f.band,
      value: f.value,
      confidence: f.confidence,
      evidence: f.evidence,
      salience: Math.round(BAND_SALIENCE[f.band] * f.confidence * 1000) / 1000,
    }))
    .sort((a, b) => b.salience - a.salience || a.id.localeCompare(b.id))
}

/* ============================================================
   专题段
   ============================================================ */

export interface TopicSection {
  /** 二级标题原文 */
  title: string
  /** 命中该专题的特征 id 前缀。一条特征可以喂多个专题 */
  feeds: readonly string[]
  /** 用户「关注方向」里出现这些词就加权 */
  focusWords: readonly string[]
  /** 写这一段时要落在什么上 —— 直接进 prompt */
  brief: string
}

/**
 * 专题池。标题都是传统相术自己的说法，不是现代心理学量表的搬运。
 *
 * feeds 用 id 前缀而不是 label，因为 label 随档位变，而「这条特征属于哪个话题」
 * 不随档位变。
 */
export const TOPIC_POOL: readonly TopicSection[] = [
  {
    title: '气度与格局',
    feeds: ['face.threeCourts', 'face.fiveEye', 'face.symmetry', 'face.fiveElements', 'face.shape', 'face.innerGap', 'bone.headShape', 'bone.thickness', 'body.somatotype', 'body.proportion', 'hand.type'],
    focusWords: ['格局', '气度', '整体', '性格', '为人'],
    brief: '整体格局与气象：三停/五形/体型这类通盘的判断，先定这个人的基本气质，再谈别的',
  },
  {
    title: '才思与识见',
    feeds: ['face.palace.mingGong', 'face.eye.shape', 'face.eye.openness', 'face.brow.shape', 'bone.frontal', 'hand.line.head', 'hand.mount.moon'],
    focusWords: ['聪明', '才智', '思考', '学习', '读书', '判断', '眼光'],
    brief: '心思与识见：命宫、眼、智慧线所主的思虑方式 —— 是快断还是回旋，是好深究还是重直觉',
  },
  {
    title: '情感与人际',
    feeds: ['face.mouth.corner', 'face.mouth.lip', 'face.brow.length', 'face.palace.tianzhai', 'face.marks', 'hand.line.heart', 'hand.finger.little', 'hand.mount.mercury', 'body.survey'],
    focusWords: ['感情', '婚姻', '恋爱', '朋友', '人际', '相处', '家人', '亲情'],
    brief: '情性与待人：口、唇、眉长、感情线所主的亲疏冷热与表达方式。只谈这个人怎么与人相处，不谈他该与谁相处',
  },
  {
    title: '财帛与积累',
    feeds: ['face.palace.caibo', 'face.nose.alar', 'face.mouth.philtrum', 'face.nose.root', 'hand.mount.venus', 'hand.line.life', 'bone.zygomatic'],
    focusWords: ['财', '钱', '收入', '事业', '工作', '积累', '投资'],
    brief: '财帛与守成：财帛宫、鼻翼、金星丘所主的进取与守成之力 —— 谈的是聚散的倾向与节奏，不谈数目、不谈时间',
  },
  {
    title: '家宅与根基',
    feeds: ['face.threeCourts.lower', 'face.palace.tianzhai', 'bone.spine', 'bone.shoulder', 'body.posture', 'hand.line.life'],
    focusWords: ['家', '家宅', '房子', '父母', '根基', '晚年', '故乡', '安定'],
    brief: '根基与居止：下停、田宅宫、脊骨体态所主的安处之力与长期依托',
  },
  {
    title: '行止与执守',
    feeds: ['face.brow.tail', 'face.brow.density', 'face.eye.sclera', 'face.nasolabial', 'bone.mandible', 'bone.boneFlesh', 'hand.line.fate', 'hand.finger.thumb', 'body.posture.trunk'],
    focusWords: ['执行', '毅力', '坚持', '决断', '行动', '拖延', '意志'],
    brief: '行止与执守：眉尾、下颌、骨肉、命运线所主的着力方式 —— 能不能扛、扛得久不久、认不认死理',
  },
  {
    title: '运势节奏',
    feeds: ['face.threeCourts', 'face.palace', 'face.complexion', 'hand.line.fate', 'hand.line.sun', 'body.skin'],
    focusWords: ['运势', '运气', '流年', '起落', '时运', '节奏'],
    brief: '运势的节奏：按该相术的传统维度谈早中晚的起落与用力时机。**只谈倾向与节奏，不谈具体事件与时间**',
  },
]

/** 承担内容义务、不许缺的段。顺序即报告里的顺序 */
export const CORE_OPENING = ['特征识别', '断语', '性格特质'] as const
export const CORE_CLOSING = ['状态提示', '发展建议'] as const

export interface Outline {
  /** 报告的完整二级标题序列，顺序即输出顺序 */
  sections: string[]
  /** 本次入选的专题段及其写作要点 */
  topics: TopicSection[]
  /** 各专题的显著度得分，供审计与 dev 页面查看 */
  scores: [string, number][]
  /** 最反常的若干项 */
  salient: SalientFeature[]
}

const MIN_TOPICS = 2
const MAX_TOPICS = 4
/** 入选门槛：显著度不到头名这个比例的专题不入选 */
const RELATIVE_FLOOR = 0.45
/**
 * 每个专题只计入最显著的这几项。
 *
 * 为什么不直接求和 —— feeds 列得多的专题会仅仅因为「管的面广」而永远胜出。
 * 实测过：「气度与格局」有 11 条 feeds，按求和算它 100% 入选，
 * 于是这一段又变成了模板的一部分。只取前几项，比的就变成
 * 「这个人在这个方面有没有几件真正扎眼的事」，而不是「这个方面有多少项可测」。
 */
const TOPIC_DEPTH = 3

/**
 * 只有**偏离中和**的项才决定写哪几段。
 *
 * 光靠 TOPIC_DEPTH 还不够：categorical 项（五形、脸型、手型）人人都有一个值，
 * 于是喂了三四个 categorical 的专题拿到一条与人无关的保底分，照样 100% 入选。
 * balanced 同理 —— 它是常态，不是这个人的特点。
 *
 * 所以选段只看偏离档。这两类项**仍然进报告**（它们照旧出现在
 * 「最反常的几项」与正文里），只是不参与「该写哪几段」的表决 ——
 * 决定写什么的应当是这个人偏离了什么，而不是有多少项可测。
 *
 * 一个人若一项都不偏离，那就只写核心段。一份短而实的报告，
 * 比硬凑出四段放在谁身上都成立的话要好。
 */
const DEVIATING: ReadonlySet<Band> = new Set<Band>(['very_low', 'low', 'high', 'very_high'])

function matchesFeed(id: string, feeds: readonly string[]): boolean {
  return feeds.some((f) => id === f || id.startsWith(f + '.') || id.startsWith(f))
}

/**
 * 算出这一份报告的提纲。
 *
 * @param focusTopics 用户填的关注方向。命中专题的 focusWords 就加权 ——
 *        用户想问财帛，报告里就该有财帛那一段，而不是把这句话丢在 prompt 末尾。
 */
export function buildOutline(features: FeatureItem[], focusTopics: string[] = []): Outline {
  const salient = rankSalience(features)
  const focus = focusTopics.filter(Boolean).join(' ')

  const scored = TOPIC_POOL.map((topic) => {
    // salient 已按显著度降序，取前 TOPIC_DEPTH 条即最显著的几项
    const matched = salient.filter((f) => DEVIATING.has(f.band) && matchesFeed(f.id, topic.feeds))
    let score = matched.slice(0, TOPIC_DEPTH).reduce((sum, f) => sum + f.salience, 0)
    // 关注方向命中 —— 加一个足以把该专题拉进前列的定额，但不保证入选，
    // 因为一段完全没测到东西的专题写出来只能是空话
    const focused = topic.focusWords.some((w) => focus.includes(w))
    if (focused && score > 0) score += 1.5
    return { topic, score: Math.round(score * 1000) / 1000, focused, matched: matched.length }
  }).sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title))

  const top = scored[0]?.score ?? 0
  const qualified = scored.filter((s) => s.score > 0 && s.score >= top * RELATIVE_FLOOR)
  const picked = qualified.slice(0, MAX_TOPICS)
  // 不足下限时按得分补齐，实在没有可补的就少写几段 —— 宁缺毋滥
  while (picked.length < MIN_TOPICS && picked.length < scored.length) {
    const next = scored[picked.length]
    if (!next || next.score <= 0) break
    picked.push(next)
  }

  return {
    sections: [...CORE_OPENING, ...picked.map((p) => p.topic.title), ...CORE_CLOSING],
    topics: picked.map((p) => p.topic),
    scores: scored.map((s) => [s.topic.title, s.score]),
    salient,
  }
}

/** 提纲里可能出现的全部二级标题 —— guard 的白名单由此派生 */
export const ALL_TOPIC_TITLES = TOPIC_POOL.map((t) => t.title)
