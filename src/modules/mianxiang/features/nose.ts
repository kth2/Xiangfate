/**
 * 财帛宫（鼻）。传统里鼻是「中岳」，兼主财帛与意志，是全脸最吃 3D 的部位 ——
 * 山根高不高、准头够不够丰、鼻梁有没有起节，在正面二维投影里几乎看不出来，
 * 必须靠深度。
 *
 * 这里的深度全部相对**面平面**或**局部基准线**来量，因此与整张脸的前后位置无关。
 */

import { dot3, len3, sub3 } from '@/core/vec3'
import { NOSE, NASAL_ROOT, NOSE_TIP, SUBNASALE } from '../landmarks'
import { prominence, type FaceFrame } from '../normalize'
import { iodStr, pctStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

/** 鼻梁中段（年寿），起节与否看这里 */
const BRIDGE_MID = 6

const SPECS: FeatureSpec[] = [
  {
    id: 'face3d.nose.length',
    label: '鼻长',
    category: '鼻',
    unit: 'iod',
    method: 'geometry',
    source: '麻衣神相',
    describe: '山根至鼻底的帧内长度 ÷ IOD',
  },
  {
    id: 'face3d.nose.alarWidth',
    label: '鼻翼宽',
    category: '鼻',
    unit: 'iod',
    method: 'geometry',
    source: '神相全编',
    describe: '两侧鼻翼最外缘距离 ÷ IOD',
  },
  {
    id: 'face3d.nose.rootDepth',
    label: '山根隆起',
    category: '鼻',
    unit: 'iod',
    method: 'shading',
    source: '神相全编',
    describe: '山根相对面平面的前突量。传统「山根低陷」为中年之忌，看的就是它',
  },
  {
    id: 'face3d.nose.tipProjection',
    label: '准头前突',
    category: '十二宫',
    unit: 'iod',
    method: 'shading',
    source: '麻衣神相',
    describe: '鼻尖相对两侧鼻翼连线中点的前突量 —— 真正的「准头丰圆」',
  },
  {
    id: 'face3d.nose.dorsumConvexity',
    label: '鼻梁曲直',
    category: '鼻',
    unit: 'iod',
    method: 'shading',
    source: '神相全编',
    describe: '鼻梁中段相对山根—准头连线的矢高。正 = 起节隆起，负 = 塌陷',
  },
  {
    id: 'face3d.nose.alarFlare',
    label: '鼻翼张度',
    category: '鼻',
    unit: 'ratio',
    method: 'geometry',
    source: '神相全编',
    describe: '鼻翼宽 ÷ 鼻长。传统「财库」丰不丰，看的是这个比例而不是绝对宽度',
  },
  {
    id: 'face3d.nose.deviation',
    label: '鼻梁偏斜',
    category: '鼻',
    unit: 'iod',
    method: 'geometry',
    source: '麻衣神相',
    describe: '鼻梁各点离中矢面的最大偏移。传统称「梁柱欹曲」',
  },
]

export const noseModule: FeatureModule = {
  name: 'nose',
  specs: SPECS,
  compute(frame: FaceFrame): Measurement[] {
    const P = frame.points
    const poseFactor = frame.poseFactor

    const root = P[NASAL_ROOT]
    const tip = P[NOSE_TIP]
    const base = P[SUBNASALE]
    const alarL = P[NOSE.alarLeft]
    const alarR = P[NOSE.alarRight]

    const length = len3(sub3(base, root))
    const alarWidth = len3(sub3(alarL, alarR))

    /* ---- 山根隆起：相对面平面 ---- */
    const rootDepth = prominence(frame, [NASAL_ROOT])

    /* ---- 准头前突：相对两鼻翼中点 ----
     * 用鼻翼做基准而不是面平面，是为了把「整个鼻子高」与「鼻头本身丰」分开：
     * 前者是山根的事，后者才是准头。 */
    const alarMid = {
      x: (alarL.x + alarR.x) / 2,
      y: (alarL.y + alarR.y) / 2,
      z: (alarL.z + alarR.z) / 2,
    }
    const tipProjection = dot3(sub3(tip, alarMid), frame.facePlane.normal)

    /* ---- 鼻梁曲直：中段离「山根—准头」连线的矢高 ---- */
    const axis = sub3(tip, root)
    const axisLen = len3(axis) || 1
    const u = { x: axis.x / axisLen, y: axis.y / axisLen, z: axis.z / axisLen }
    const toMid = sub3(P[BRIDGE_MID], root)
    const along = dot3(toMid, u)
    const perp = sub3(toMid, { x: u.x * along, y: u.y * along, z: u.z * along })
    // 取前后方向的分量：正 = 向前鼓（起节），负 = 塌
    const dorsumConvexity = dot3(perp, frame.facePlane.normal)

    /* ---- 鼻梁偏斜：离中矢面的最大绝对偏移 ---- */
    const deviation = Math.max(
      ...NOSE.bridge.map((i) => Math.abs(dot3(sub3(P[i], frame.midsagittal.point), frame.midsagittal.normal))),
    )

    const flare = length > 1e-6 ? alarWidth / length : 0

    return [
      {
        specId: 'face3d.nose.length',
        value: round3(length),
        evidence: `山根至鼻底 ${iodStr(length)}`,
      },
      {
        specId: 'face3d.nose.alarWidth',
        value: round3(alarWidth),
        evidence: `鼻翼外缘间距 ${iodStr(alarWidth)}`,
      },
      {
        specId: 'face3d.nose.rootDepth',
        value: round3(rootDepth),
        evidence: `山根相对面平面前突 ${iodStr(rootDepth)}`,
        factor: poseFactor,
        status: 'inferred',
      },
      {
        specId: 'face3d.nose.tipProjection',
        value: round3(tipProjection),
        evidence: `准头较两鼻翼连线中点前突 ${iodStr(tipProjection)}`,
        factor: poseFactor,
        status: 'inferred',
      },
      {
        specId: 'face3d.nose.dorsumConvexity',
        value: round3(dorsumConvexity),
        evidence: `鼻梁中段相对山根—准头连线${dorsumConvexity >= 0 ? '外凸' : '内凹'} ${iodStr(Math.abs(dorsumConvexity))}`,
        factor: poseFactor,
        status: 'inferred',
      },
      {
        specId: 'face3d.nose.alarFlare',
        value: round3(flare),
        evidence: `鼻翼宽为鼻长的 ${pctStr(flare)}`,
      },
      {
        specId: 'face3d.nose.deviation',
        value: round3(deviation),
        evidence: `鼻梁各点离中矢面最大偏移 ${iodStr(deviation)}`,
      },
    ]
  },
}
