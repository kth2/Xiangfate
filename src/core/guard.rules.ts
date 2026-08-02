/**
 * 输出后置校验的词表与规则。与 docs/07-content-policy.md 同源。
 *
 * 这是**唯一一道不依赖模型配合**的防线 —— Prompt 可能被绕过、被忽略、
 * 被模型的训练倾向压过，但这里是确定性的字符串匹配。
 */

/** 绝对化断言。命中 → 触发一次重生成，再犯则删句 */
export const BANNED_ABSOLUTE = [
  '必定', '一定会', '肯定会', '注定', '必有', '绝对', '无疑', '势必', '终将',
  '逃不过', '命中注定', '铁定', '难逃', '毫无疑问',
]

/** 寿夭与重大人生断言。命中 → 直接删句，不重生成（避免二次风险） */
export const BANNED_FATE = [
  '短命', '长寿之相', '夭折', '寿元', '阳寿', '大限', '死于', '活不过', '早夭',
  '克夫', '克妻', '克子', '丧偶', '离异之相', '孤独终老', '绝后', '难产',
  '不得善终', '血光之灾', '牢狱之灾',
]

/** 人格污名 */
export const BANNED_STIGMA = [
  '心术不正', '薄情', '寡义', '阴险', '狡诈', '奸猾', '小人相', '凶相',
  '刻薄相', '低贱', '愚钝', '没出息', '不知廉耻', '奸邪', '歹毒',
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
  | 'absolute'
  | 'fate'
  | 'stigma'
  | 'medical'
  | 'discrimination'
  | 'gendered'
  | 'time'
  | 'jargon'
  | 'unavailable_leak'
  | 'structure'

/** 命中后的处置方式 */
export const CATEGORY_ACTION: Record<GuardCategory, 'regenerate' | 'strip'> = {
  absolute: 'regenerate',
  structure: 'regenerate',
  fate: 'strip',
  stigma: 'strip',
  medical: 'strip',
  discrimination: 'strip',
  gendered: 'strip',
  time: 'strip',
  jargon: 'strip',
  unavailable_leak: 'strip',
}

export const WORD_LISTS: [GuardCategory, string[]][] = [
  ['absolute', BANNED_ABSOLUTE],
  ['fate', BANNED_FATE],
  ['stigma', BANNED_STIGMA],
  ['medical', BANNED_MEDICAL],
  ['discrimination', BANNED_DISCRIMINATION],
  ['gendered', BANNED_GENDERED],
  ['jargon', BANNED_JARGON],
]

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
