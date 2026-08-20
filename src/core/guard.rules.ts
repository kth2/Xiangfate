/**
 * 输出后置校验的词表与规则。与 docs/07-content-policy.md 同源。
 *
 * 这是**唯一一道不依赖模型配合**的防线 —— Prompt 可能被绕过、被忽略、
 * 被模型的训练倾向压过，但这里是确定性的字符串匹配。
 *
 * ⚠️ 边界已按产品决定收窄（见 docs/07 第一节）：
 * 传统相书里的性格论断 —— 心机深、城府深、薄情寡义、六亲缘薄、性情急躁、
 * 忌相之类 —— **不再拦截**，这是本 App 要呈现的东西。
 * 这里只留四类硬边界：疾病诊断、寿夭生死、性别化的婚配归咎、身材与残障贬损，
 * 外加与内容无关的技术项（时间预测、字段名泄漏、不可观测项）。
 */

import { ALL_TOPIC_TITLES } from './outline'

/**
 * 寿夭生死 + 性别化的婚配归咎。命中 → 直接删句，不重生成。
 *
 * 「克夫」「绝后」这类不是性格论断，而是把他人的祸福算在此人头上，
 * 传统上又几乎只用于女性 —— 与放开性格论断是两件事，仍然拦。
 */
export const BANNED_FATE = [
  '短命', '长寿之相', '夭折', '寿元', '阳寿', '大限', '死于', '活不过', '早夭',
  '克夫', '克妻', '克子', '丧偶', '绝后', '难产',
]

/** 疾病与医疗断言 */
export const BANNED_MEDICAL = [
  '肝胆', '肾虚', '肾气不足', '心血管', '糖尿病', '高血压', '癌', '肿瘤',
  '结石', '炎症', '病变', '确诊', '诊断', '病灶', '慢性病', '免疫力低下',
  '内分泌失调', '贫血', '骨质疏松', '中风', '心脏病', '脂肪肝', '甲状腺',
]

/** 身材、外貌、残障歧视 */
export const BANNED_DISCRIMINATION = [
  '矮个子', '高个子', '肥胖', '太胖', '太瘦', '丑陋', '难看', '残疾', '畸形',
]

/** 性别刻板 */
export const BANNED_GENDERED = [
  '女人就该', '男人就该', '女命主', '旺夫', '宜嫁', '嫁得好', '娶妻',
  '为妻之道', '相夫教子', '女子无才',
]

/** 具体时间预测。用正则是因为要匹配「时间 + 会/将/有」的组合 */
export const BANNED_TIME_PREDICTION =
  /(今年|明年|后年|\d{4}\s*年|\d+\s*岁时?|下半年|上半年|\d+\s*月|近期内)[^。；！？\n]{0,12}(会|将|有|遇|逢|主|发生|出现|迎来)/

/** JSON 字段名泄漏 —— 说明 AI 在复述数据结构而不是解读 */
export const BANNED_JARGON = [
  'confidence', 'band', 'features', 'unavailable', 'derived', 'schemaVersion',
  'analysisType', 'scorecard', 'measured', 'inferred', 'JSON',
]

export type GuardCategory =
  | 'fate'
  | 'medical'
  | 'discrimination'
  | 'gendered'
  | 'time'
  | 'jargon'
  | 'unavailable_leak'
  | 'structure'

/**
 * 命中后的处置方式。
 *
 * 只剩 structure 会触发重生成 —— 措辞类的重生成已经全部取消：
 * 原来的 absolute（必定/注定/命中注定）与 stigma（心术不正/薄情/狡诈……）
 * 两类词表已整体删除，传统断语的口气不再是问题。
 */
export const CATEGORY_ACTION: Record<GuardCategory, 'regenerate' | 'strip'> = {
  structure: 'regenerate',
  fate: 'strip',
  medical: 'strip',
  discrimination: 'strip',
  gendered: 'strip',
  time: 'strip',
  jargon: 'strip',
  unavailable_leak: 'strip',
}

export const WORD_LISTS: [GuardCategory, string[]][] = [
  ['fate', BANNED_FATE],
  ['medical', BANNED_MEDICAL],
  ['discrimination', BANNED_DISCRIMINATION],
  ['gendered', BANNED_GENDERED],
  ['jargon', BANNED_JARGON],
]

/**
 * 报告的段落白名单。
 *
 * 原来这里是一张写死的七段清单，报告必须**包含且仅包含**它、顺序固定。
 * 那张清单是「不同人读到同一篇文章」的一半原因：无论测到什么，
 * 骨架都一样。现在骨架由 core/outline.ts 按本次测到的东西算出来，
 * 这里只管两件事：哪几段不许缺（CORE），以及允许出现的段落总集（ALLOWED）。
 *
 * guardReport 接到具体提纲时按提纲逐段核对；接不到时退回这两张表 ——
 * 追问、历史记录重放这些路径上没有提纲。
 */

/** 承担内容义务、任何一份报告都不许缺的段 */
export const CORE_SECTIONS = [
  '特征识别',
  '断语',
  '性格特质',
  '状态提示',
  '发展建议',
] as const

/**
 * 允许出现的全部二级标题。
 *
 * 「能力倾向」「运势倾向」是旧七段式里的两段，保留在白名单里：
 * IndexedDB 里的历史报告是按旧骨架生成的，重放时不该被判成多余小节。
 */
export const ALLOWED_SECTIONS = [
  ...CORE_SECTIONS,
  ...ALL_TOPIC_TITLES,
  '能力倾向',
  '运势倾向',
] as const

/** 一份报告的段数上下限 —— 提纲最少 5 段（核心）、最多 9 段（核心 + 4 专题） */
export const SECTION_COUNT = { min: 5, max: 9 } as const

export const LENGTH = { min: 500, max: 2500 } as const

/** 情绪危机关键词 —— 命中则不发送该轮请求给 AI，直接出关怀卡片 */
export const CRISIS_KEYWORDS = [
  '自杀', '想死', '活不下去', '不想活', '结束生命', '自残', '割腕',
  '轻生', '解脱', '没有意义', '撑不下去',
]

/** 重大人生决定 —— 命中则提示不该用相术决定，但仍可回答 */
export const MAJOR_DECISION_KEYWORDS = [
  '离婚', '辞职', '放弃治疗', '分手', '退学', '移民', '创业还是',
  '要不要生', '打胎', '流产',
]
