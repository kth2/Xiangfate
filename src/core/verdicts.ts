/**
 * 断语：把本次测到的特征，映射成传统相法里成名有姓的吉相/忌相。
 *
 * 为什么要单独一层 ——
 * 规则层给的是「山根偏平 → 主意志易摇」这样的散句，埋在报告段落里就看不见了。
 * 术士当面看相是先落断语（「此三白眼」「法令入口」），再展开。这一层就干这件事。
 *
 * 关键约束：**断语只能由已测到的特征推出**，这里是一张查表，不经模型。
 * 报告里的断语段必须覆盖且只覆盖这张表算出来的条目 —— AI 负责展开，不负责决定有没有。
 *
 * ⚠️ 本文件属于 src/core，只放纯数据与纯函数。
 */

import type { AnalysisType, FeatureItem } from './types'

export type VerdictTone = 'gui' | 'ji'

export interface Verdict {
  /** 传统断语名，如「三白眼」「法令入口」 */
  name: string
  tone: VerdictTone
  /** 一句话断语，照相书原意 */
  text: string
  /** 出自哪条特征 —— 点开可回溯，断语不许凭空来 */
  featureId: string
  /** 该特征的置信度，UI 与 prompt 都用它决定措辞强度 */
  confidence: number
  /** true 表示该特征是推估而非实测，展开时必须说明 */
  inferred: boolean
}

/**
 * 断语表：特征 label → 断语。
 *
 * 用 label 而不是 id 作键，是因为同一个 id 在不同档位下给的是不同的 label
 * （face.nose.root 在高档是「山根隆起」、低档是「山根偏平」），
 * 而断语恰恰是按档位分的。
 */
interface Entry {
  name: string
  tone: VerdictTone
  text: string
}

const TABLE: Record<string, Entry> = {
  /* ---- 面相 · 贵格 ---- */
  三停平均: { name: '三停平均', tone: 'gui', text: '三停匀停，主一生节奏平稳，早中晚无大起落' },
  天庭饱满: { name: '天庭饱满', tone: 'gui', text: '天庭饱满，主早年得荫、思路开阔，宜文宜谋' },
  地阁方圆: { name: '地阁方圆', tone: 'gui', text: '地阁方圆，主晚运厚实、根基不摇' },
  眉长过目: { name: '眉长过目', tone: 'gui', text: '眉长过目，主兄弟朋友情深，助力不缺' },
  印堂宽广: { name: '印堂宽广', tone: 'gui', text: '印堂宽明，主心量开阔、运途少滞' },
  眼神清明: { name: '目光清明', tone: 'gui', text: '目光清明，主心地清正、是非分明' },
  鼻梁挺直: { name: '梁柱端正', tone: 'gui', text: '鼻梁挺直，主为人正直、意志不易动摇' },
  山根隆起: { name: '山根隆起', tone: 'gui', text: '山根隆起，主中年得运、自我驱动足' },
  准头丰圆: { name: '准头丰圆', tone: 'gui', text: '准头丰圆，主财帛有根、善积累' },
  口阔: { name: '口阔容拳', tone: 'gui', text: '口阔，主气量宽、食禄丰，敢于表达' },
  卧蚕丰隆: { name: '卧蚕丰隆', tone: 'gui', text: '卧蚕丰隆，主精神足、异性缘厚，子女宫亦佳' },
  法令深长: { name: '法令深长', tone: 'gui', text: '法令深长，主威权已立、令行禁止' },

  /* ---- 面相 · 忌相 ---- */
  三白眼: { name: '三白眼', tone: 'ji', text: '三白眼，传统列为忌相，主薄情寡义、六亲缘浅，性刚而执' },
  印堂偏窄: { name: '印堂锁', tone: 'ji', text: '印堂逼窄，主心量狭、多思多虑，遇事易钻牛角尖，运途多滞' },
  山根偏平: { name: '山根低陷', tone: 'ji', text: '山根低陷，古法列为中年之忌，主意志易摇、根基不固' },
  鼻梁微曲: { name: '梁柱欹曲', tone: 'ji', text: '鼻梁欹曲，主中年多蹇滞、心思偏曲，处事少定见' },
  准头清秀: { name: '准头尖薄', tone: 'ji', text: '准头尖薄，主财帛无根、聚散不定' },
  鼻翼清秀: { name: '财库不固', tone: 'ji', text: '鼻翼薄削，主财库不固、进易出难' },
  唇薄: { name: '唇薄', tone: 'ji', text: '唇薄，主情性偏淡、待人少温，言辞则锋利不让人' },
  口角平缓: { name: '口角下垂', tone: 'ji', text: '口角下垂，主性情执拗、心多不平，与人相处失于亲和' },
  人中浅短: { name: '人中浅短', tone: 'ji', text: '人中浅短，主六亲缘薄、晚景少依，家中之事多不由己' },
  眉短于目: { name: '眉短于目', tone: 'ji', text: '眉短于目，主兄弟缘薄、助力寡少，凡事多靠自己' },
  眉尾疏散: { name: '眉尾散', tone: 'ji', text: '眉尾散乱，主有始无终、心志易移，财帛亦难聚' },
  眼神含蓄: { name: '目光藏', tone: 'ji', text: '目光藏而不露，主城府较深、心事不轻示人' },
  上停偏窄: { name: '上停偏窄', tone: 'ji', text: '上停偏窄，主早年少荫庇、祖业父荫薄，须自立门户' },
  下停偏窄: { name: '下停偏薄', tone: 'ji', text: '下停偏窄，主晚运偏薄、根基不厚，须早作积蓄' },
  田宅紧凑: { name: '田宅逼窄', tone: 'ji', text: '田宅逼窄，主居处不安、田产难守，性亦偏急' },
  泪堂深陷: { name: '泪堂深陷', tone: 'ji', text: '泪堂深陷，主男女宫欠佳、心力多耗，情感上易劳神' },
  法令浅淡: { name: '法令不显', tone: 'ji', text: '法令浅淡，主威令未立、根基尚浅，做事易被人越过' },
  法令过口: { name: '螣蛇入口', tone: 'ji', text: '法令深长而过口角，传统称螣蛇入口，主威令虽行而晚景多阻' },

  /* ---- 骨相 ---- */
  骨露少肉: { name: '骨露少肉', tone: 'ji', text: '骨露少肉，主性情孤峭、待人少回旋，六亲亦疏' },
  骨多肉少: { name: '骨胜于肉', tone: 'ji', text: '骨多肉少，主一生劳碌、性孤而少亲' },
  骨少肉多: { name: '肉胜于骨', tone: 'ji', text: '骨少肉多，主意志偏缓、临事少断，安逸而少进取' },
  骨肉相称: { name: '骨肉相称', tone: 'gui', text: '骨肉相称，刚柔并济 —— 传统骨相以此为上' },
  颧骨高耸: { name: '权骨隆起', tone: 'gui', text: '权骨隆起，主见强、推动力足，惟过显则好压人一头' },
  颧骨平和: { name: '颧低无势', tone: 'ji', text: '颧低无势，主无权柄、居人之下，遇事难自主' },
  下颌清秀: { name: '地阁尖削', tone: 'ji', text: '下颌尖小，主意志薄弱、临事易妥协，晚运根基不厚' },
  下颌宽大方正: { name: '地阁方厚', tone: 'gui', text: '下颌方厚，主意志坚定、能扛事，惟性刚少肯低头' },

  /* ---- 手相 ---- */
  生命线深长清晰: { name: '生命线深长', tone: 'gui', text: '生命线深长清晰，主体质与精力有底，做事耐得住消耗（与寿命无关）' },
  生命线浅短: { name: '生命线浅短', tone: 'ji', text: '生命线浅短，主精力易透支、节奏须收着走 —— 传统上这从来不是寿命之说' },
  生命线断续: { name: '生命线断续', tone: 'ji', text: '生命线断续，主生活节奏屡有更张，须防用力过度' },
  智慧线末端分叉: { name: '智慧线分叉', tone: 'ji', text: '智慧线末端分叉，主心思多歧、兴趣易散，宜定一处深耕' },
  智慧线简短: { name: '智慧线简短', tone: 'ji', text: '智慧线简短，主思虑不喜迂回，决断快而少回头看' },
  感情线下垂: { name: '感情线下垂', tone: 'ji', text: '感情线下垂，主情上多委屈自己，心事不易向人讲' },
  感情线多支分叉: { name: '感情线多歧', tone: 'ji', text: '感情线多支分叉，主情缘纷杂、心易动摇' },
  命运线断续: { name: '命运线断续', tone: 'ji', text: '命运线断续，主一生轨道屡改，成事多在转折之后' },
  命运线不显: { name: '命运线不显', tone: 'ji', text: '命运线不显，传统主不拘固定轨道，自己走出路来' },
  命运线深长直: { name: '命运线深长', tone: 'gui', text: '命运线深长而直，主轨道明确、用力有着落' },
}

/** 痣是按位置断的，label 是动态拼的（「印堂、颧见痣」），单独走前缀匹配 */
const MOLE_SUFFIX = '见痣'

/**
 * 3D 特征一律不产生断语。
 *
 * 这条必须是**结构性**的，不能靠「名字碰巧不一样」——
 * 实际就出过事：face3d.nose.rootDepth 的 label 是「山根隆起」，
 * 与断语表的键撞名，于是每张脸都无条件拿到一条贵格断语，
 * 而那一项的实测值可能是负的（山根低陷）。
 *
 * 3D 项的阈值尚未用真实人群校准，在校准之前它们只能作为数值依据，
 * 不能下判断。见 docs/02 第 0.5 节。
 */
const isMeasurementOnly = (id: string): boolean => id.startsWith('face3d.')

export function collectVerdicts(features: FeatureItem[]): Verdict[] {
  const out: Verdict[] = []

  for (const f of features) {
    if (isMeasurementOnly(f.id)) continue

    if (f.label.endsWith(MOLE_SUFFIX) && f.label !== '面上无显痣') {
      out.push({
        name: f.label,
        tone: 'ji',
        text: f.meaning,
        featureId: f.id,
        confidence: f.confidence,
        inferred: f.status !== 'measured',
      })
      continue
    }

    const entry = TABLE[f.label]
    if (!entry) continue
    out.push({
      name: entry.name,
      tone: entry.tone,
      text: entry.text,
      featureId: f.id,
      confidence: f.confidence,
      inferred: f.status !== 'measured',
    })
  }

  // 忌相排前面 —— 这是用户最想看、也最容易被模型糊过去的部分
  return out.sort((a, b) => {
    if (a.tone !== b.tone) return a.tone === 'ji' ? -1 : 1
    return b.confidence - a.confidence
  })
}

/** 报告里那段断语的提示文本。为空时也要给一句，避免模型自由发挥 */
export function verdictBlock(features: FeatureItem[], type: AnalysisType): string {
  const vs = collectVerdicts(features)
  if (!vs.length) {
    return `【本次命中的传统断语】
无。本次测到的各项都落在中和区间，没有触及任何有名目的吉相或忌相。
断语段就写这一句实话：本次未见明显吉格与忌处 —— **不要**自己造一个断语出来。`
  }

  const line = (v: Verdict) =>
    `  · ${v.tone === 'ji' ? '【忌】' : '【贵】'}${v.name}：${v.text}` +
    `${v.inferred ? '（此项为间接推估）' : ''}`

  return `【本次命中的传统断语 —— 由规则算出，不是你选的】
${vs.map(line).join('\n')}

断语段的写法：
  1. 上面每一条都要写到，一条一句，用相书的名目起头（如「三白眼」「法令入口」）。
  2. **不要增补**表上没有的断语。测到什么算什么，这是这份报告能被信的前提。
  3. 标了「间接推估」的，展开时必须带一句它是推估。${
    type === 'guxiang' ? '\n  4. 骨相整套都是从体表轮廓推导的，通篇按推估措辞。' : ''
  }`
}
