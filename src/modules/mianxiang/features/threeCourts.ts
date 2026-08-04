/**
 * 三停。上停主早年、中停主中年、下停主晚年。
 *
 * 与旧的二维实现相比，这里的高度是在**规范帧的 y 轴**上量的：
 * 抬头低头会让图像 y 方向的三段比例失真，帧内则不会。
 */

import { MIDLINE, THREE_COURTS } from '../landmarks'
import { HAIRLINE_FACTOR } from '../thresholds'
import type { FaceFrame } from '../normalize'
import { pctStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

const SPECS: FeatureSpec[] = [
  {
    id: 'face3d.threeCourts.upper',
    label: '上停占比',
    category: '三停',
    unit: 'ratio',
    method: 'meshHairline',
    source: '麻衣神相',
    describe: '发际线至眉心线，占全脸高度之比。发际线由网格顶端外推，故可靠度天然偏低',
  },
  {
    id: 'face3d.threeCourts.middle',
    label: '中停占比',
    category: '三停',
    unit: 'ratio',
    method: 'geometry',
    source: '麻衣神相',
    describe: '眉心线至鼻底，占全脸高度之比',
  },
  {
    id: 'face3d.threeCourts.lower',
    label: '下停占比',
    category: '三停',
    unit: 'ratio',
    method: 'geometry',
    source: '麻衣神相',
    describe: '鼻底至颏底，占全脸高度之比',
  },
  {
    id: 'face3d.threeCourts.balance',
    label: '三停匀称度',
    category: '三停',
    unit: 'score',
    method: 'geometry',
    source: '麻衣神相',
    describe: '1 − 三段两两最大差值 ÷ 1/3，1 为完全均分',
  },
  {
    id: 'face3d.threeCourts.tilt',
    label: '中轴偏斜',
    category: '三停',
    unit: 'deg',
    method: 'geometry',
    source: null,
    describe: '中轴点连线相对帧内竖直方向的夹角，反映五官整体的左右倾斜',
  },
]

export const threeCourtsModule: FeatureModule = {
  name: 'threeCourts',
  specs: SPECS,
  compute(frame: FaceFrame): Measurement[] {
    const P = frame.points
    const yOf = (i: number) => P[i].y

    const browLineY = THREE_COURTS.browLine.reduce((s, i) => s + yOf(i), 0) / THREE_COURTS.browLine.length
    const yTop = yOf(THREE_COURTS.top)
    const yNose = yOf(THREE_COURTS.noseBase)
    const yChin = yOf(THREE_COURTS.chin)

    // landmark 10 是网格顶端而非真实发际线，直接用会把上停系统性低估约一半
    const upper = (browLineY - yTop) * HAIRLINE_FACTOR
    const middle = yNose - browLineY
    const lower = yChin - yNose
    const total = upper + middle + lower || 1

    const u = upper / total
    const m = middle / total
    const l = lower / total
    const maxDiff = Math.max(Math.abs(u - m), Math.abs(m - l), Math.abs(u - l))
    const balance = Math.max(0, 1 - maxDiff / (1 / 3))

    // 中轴偏斜：把中轴点拟合成一条线，看它离帧内竖直差多少
    const mid = MIDLINE.map((i) => P[i])
    const dy = mid[mid.length - 1].y - mid[0].y
    const dx = mid[mid.length - 1].x - mid[0].x
    const tilt = (Math.atan2(dx, dy) * 180) / Math.PI

    const courts = `上 ${pctStr(u)} · 中 ${pctStr(m)} · 下 ${pctStr(l)}`

    return [
      {
        specId: 'face3d.threeCourts.upper',
        value: round3(u),
        evidence: `${courts}（上停经发际线系数 ${HAIRLINE_FACTOR} 修正）`,
      },
      { specId: 'face3d.threeCourts.middle', value: round3(m), evidence: courts },
      { specId: 'face3d.threeCourts.lower', value: round3(l), evidence: courts },
      {
        specId: 'face3d.threeCourts.balance',
        value: round3(balance),
        evidence: `三段两两最大差 ${pctStr(maxDiff)}，均分为 33.3% 时匀称度为 1`,
      },
      {
        specId: 'face3d.threeCourts.tilt',
        value: round3(tilt),
        evidence: `中轴连线偏离帧内竖直 ${tilt.toFixed(1)}°`,
      },
    ]
  },
}
