/**
 * 追问的预设问题。与 docs/xiangshu-qa-knowledge.md 各章「预设问题」同源。
 *
 * 选题原则：
 *   · 都是求测者真的会问的（知识库里的「最常问」），不是我们希望他们问的；
 *   · 每一条都必须落在本次能测到的特征上（痣、卧蚕、法令纹已可测，见 modules/mianxiang/marks.ts）；
 *   · 都不触碰寿夭、婚姻成败、子女、具体时间（那些即使问了也只会得到「不作论断」）。
 * 新增条目需同时通过 core/__tests__/qa.test.ts 里的前置检查用例。
 */

import type { QaTopic } from '@/core/qa'
import type { AnalysisType } from '@/core/types'

export interface PresetQuestion {
  id: string
  /** 按钮文案，同时就是发给 AI 的问题原文 */
  text: string
  topic: QaTopic
}

export const PRESET_QUESTIONS: Record<AnalysisType, PresetQuestion[]> = {
  mianxiang: [
    { id: 'mian-overall', text: '我的面相整体格局如何？', topic: 'overall' },
    { id: 'mian-wealth', text: '财帛方面有什么提示？', topic: 'wealth' },
    { id: 'mian-career', text: '事业上适合什么方向？', topic: 'career' },
    { id: 'mian-relation', text: '与人相处上要注意什么？', topic: 'relationship' },
    { id: 'mian-color', text: '近期气色透露出什么状态？', topic: 'health' },
    { id: 'mian-marks', text: '面上的痣与法令纹传统怎么看？', topic: 'overall' },
    { id: 'mian-personality', text: '性格上别人可能怎么看我？', topic: 'personality' },
  ],

  shouxiang: [
    { id: 'shou-life', text: '生命线说明我的体质和精力如何？', topic: 'health' },
    { id: 'shou-head', text: '智慧线看我的思维方式是怎样的？', topic: 'personality' },
    { id: 'shou-heart', text: '感情线看我怎么表达情感？', topic: 'relationship' },
    { id: 'shou-fate', text: '命运线的起伏说明什么？', topic: 'career' },
    { id: 'shou-shape', text: '我的手型偏哪种气质？', topic: 'overall' },
    { id: 'shou-hands', text: '左右手的差别说明什么？', topic: 'overall' },
  ],

  guxiang: [
    { id: 'gu-overall', text: '从面部轮廓看，我的骨性特征偏怎样？', topic: 'overall' },
    { id: 'gu-cheek', text: '颧骨与下颌在传统里有什么说法？', topic: 'personality' },
    { id: 'gu-flesh', text: '我的骨肉关系属于清还是厚？', topic: 'overall' },
    { id: 'gu-career', text: '这样的骨格适合什么做事方式？', topic: 'career' },
    { id: 'gu-unobservable', text: '哪些传统骨位是照片看不了的？', topic: 'overall' },
  ],

  tixiang: [
    { id: 'ti-ratio', text: '我的体态比例在传统体相里怎么看？', topic: 'overall' },
    { id: 'ti-air', text: '我的气质偏沉稳还是进取？', topic: 'personality' },
    { id: 'ti-posture', text: '站姿与重心说明什么？', topic: 'health' },
    { id: 'ti-career', text: '体相看我做事的用力方式是怎样的？', topic: 'career' },
    { id: 'ti-care', text: '有没有适合我的养形养气建议？', topic: 'health' },
  ],
}

/** 追问区标题下的一句提示 */
export const PRESET_HINT = '可以直接点一个，也可以自己写'

export function presetsFor(type: AnalysisType): PresetQuestion[] {
  return PRESET_QUESTIONS[type] ?? []
}
