/**
 * 体相可选自评。补足照片测不到的三个维度（《冰鉴》里属于「神」的部分）。
 *
 * 刻意不问的：
 * · 衣着色彩偏好 —— 与相术关联牵强
 * · 睡姿 —— 过于私密
 * 身高体重单列，且只喂给体型换算，不生成任何高矮胖瘦的评价。
 */

import type { TixiangDerived } from '@/core/types'

export type SurveyAnswers = NonNullable<TixiangDerived['survey']>

export interface SurveyQuestion {
  key: keyof SurveyAnswers
  question: string
  options: readonly string[]
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  { key: 'voice', question: '你的声音更接近？', options: ['洪亮', '柔和', '低沉', '清亮'] },
  { key: 'speechPace', question: '你说话的节奏？', options: ['偏快', '适中', '偏慢'] },
  {
    key: 'dressStyle',
    question: '日常穿着更偏向？',
    options: ['整洁得体', '随意自然', '时尚前卫', '传统保守', '朴素简约'],
  },
]

export const SURVEY_COPY = {
  title: '还有三个问题，照片看不出来',
  note: '这几项在《冰鉴》里属于「神」的部分，填了会更完整。',
  skip: '跳过，直接出报告',
  bodyTitle: '身高体重（可选）',
  bodyNote: '只用来换算体型，报告里不会出现任何跟高矮胖瘦挂钩的评价。',
} as const

export function isSurveyEmpty(a: SurveyAnswers | null): boolean {
  return !a || !Object.values(a).some((v) => v !== undefined && v !== null)
}
