/**
 * 五岳。传统把面部五处高地比作五座山：
 *   中岳嵩山 —— 鼻       东岳泰山 —— 左颧     西岳华山 —— 右颧
 *   南岳衡山 —— 额       北岳恒山 —— 颏
 *
 * 相书讲究「五岳朝拱」：四岳要有势，且都朝向中岳，中岳不能孤峰独耸。
 * 这套说法本质上就是在描述**面部的三维起伏关系** ——
 * 二维投影里根本无从谈起，这是 3D 化最直接的受益项。
 *
 * 每岳的「势」= 该区域相对面平面的前突量（IOD 单位）。
 */

import { CHIN_BOTTOM, CHIN_MID, FOREHEAD_MID, FOREHEAD_SIDE, NOSE_TIP, ZYGOMATIC } from '../landmarks'
import { prominence, type FaceFrame } from '../normalize'
import { iodStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

/** 各岳的采样点。取小簇而非单点，抗单点抖动 */
const PEAKS = {
  中岳: [NOSE_TIP, 5, 195],
  东岳: [ZYGOMATIC.left, 425, 280],
  西岳: [ZYGOMATIC.right, 205, 50],
  南岳: [FOREHEAD_MID, FOREHEAD_SIDE.left, FOREHEAD_SIDE.right, 9],
  北岳: [CHIN_MID, CHIN_BOTTOM, 200],
} as const

export type Peak = keyof typeof PEAKS

const SPECS: FeatureSpec[] = [
  {
    id: 'face3d.wuYue.zhong',
    label: '中岳之势',
    category: '五岳',
    unit: 'iod',
    method: 'shading',
    source: '麻衣神相',
    describe: '鼻部相对面平面的前突量。中岳为五岳之主',
  },
  {
    id: 'face3d.wuYue.dong',
    label: '东岳之势',
    category: '五岳',
    unit: 'iod',
    method: 'shading',
    source: '麻衣神相',
    describe: '左颧相对面平面的前突量',
  },
  {
    id: 'face3d.wuYue.xi',
    label: '西岳之势',
    category: '五岳',
    unit: 'iod',
    method: 'shading',
    source: '麻衣神相',
    describe: '右颧相对面平面的前突量',
  },
  {
    id: 'face3d.wuYue.nan',
    label: '南岳之势',
    category: '五岳',
    unit: 'iod',
    method: 'shading',
    source: '麻衣神相',
    describe: '额部相对面平面的前突量',
  },
  {
    id: 'face3d.wuYue.bei',
    label: '北岳之势',
    category: '五岳',
    unit: 'iod',
    method: 'shading',
    source: '麻衣神相',
    describe: '颏部相对面平面的前突量',
  },
  {
    id: 'face3d.wuYue.centrality',
    label: '中岳独高度',
    category: '五岳',
    unit: 'ratio',
    method: 'shading',
    source: '麻衣神相',
    describe: '中岳前突 ÷ 四岳平均前突。远大于 1 即传统所忌的「孤峰无辅」',
  },
  {
    id: 'face3d.wuYue.support',
    label: '五岳朝拱',
    category: '五岳',
    unit: 'score',
    method: 'shading',
    source: '麻衣神相',
    describe: '四岳之间的均衡程度，1 = 四岳齐整有辅，0 = 彼此悬殊',
  },
]

export const wuYueModule: FeatureModule = {
  name: 'wuYue',
  specs: SPECS,
  compute(frame: FaceFrame): Measurement[] {
    const p = (k: Peak) => prominence(frame, PEAKS[k])
    const zhong = p('中岳')
    const four = { 东岳: p('东岳'), 西岳: p('西岳'), 南岳: p('南岳'), 北岳: p('北岳') }
    const vals = Object.values(four)
    const avgFour = vals.reduce((s, v) => s + v, 0) / vals.length

    // 四岳彼此差多少：用极差 ÷ 平均，越小越「齐整」
    const spread = Math.max(...vals) - Math.min(...vals)
    const support = avgFour > 1e-6 ? Math.max(0, 1 - spread / (avgFour * 3)) : 0
    const centrality = Math.abs(avgFour) > 1e-6 ? zhong / avgFour : 0

    const detail = Object.entries(four)
      .map(([k, v]) => `${k} ${iodStr(v)}`)
      .join(' · ')
    const f = frame.poseFactor

    return [
      {
        specId: 'face3d.wuYue.zhong',
        value: round3(zhong),
        evidence: `中岳（鼻）前突 ${iodStr(zhong)}`,
        factor: f,
        status: 'inferred',
      },
      { specId: 'face3d.wuYue.dong', value: round3(four.东岳), evidence: detail, factor: f, status: 'inferred' },
      { specId: 'face3d.wuYue.xi', value: round3(four.西岳), evidence: detail, factor: f, status: 'inferred' },
      { specId: 'face3d.wuYue.nan', value: round3(four.南岳), evidence: detail, factor: f, status: 'inferred' },
      { specId: 'face3d.wuYue.bei', value: round3(four.北岳), evidence: detail, factor: f, status: 'inferred' },
      {
        specId: 'face3d.wuYue.centrality',
        value: round3(centrality),
        evidence: `中岳 ${iodStr(zhong)}，四岳均值 ${iodStr(avgFour)}，比值 ${centrality.toFixed(2)}`,
        factor: f,
        status: 'inferred',
      },
      {
        specId: 'face3d.wuYue.support',
        value: round3(support),
        evidence: `四岳前突极差 ${iodStr(spread)}（${detail}）`,
        factor: f,
        status: 'inferred',
      },
    ]
  },
}
