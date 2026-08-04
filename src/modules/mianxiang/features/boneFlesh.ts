/**
 * 骨肉代理（几何版）。
 *
 * 「骨为君，肉为臣」——骨相把骨与肉的比例看得比任何单项都重。
 * 但照片测不到骨。骨相模块现有的做法是拿**像素轮廓锐度**近似，
 * 那受光照影响极大；这里给一个纯几何的、与光照无关的代理，两者互为参照。
 *
 * 三个代理量：
 *   · jawAngularity  下颌轮廓的转折锐度 —— 骨感的脸转折硬，肉感的脸转折圆
 *   · cheekFullness  颊部相对「颧—颌」连线的外鼓量 —— 鼓即有肉
 *   · boneFleshIndex 两者合成，高 = 骨多肉少
 *
 * ⚠️ 这是**代理**，不是测量：胖瘦、年龄、表情都会影响它。
 * 因此以 inferred 出具，且措辞里必须带上推估。
 */

import { dot3, len3, norm3, sub3 } from '@/core/vec3'
import { GONION, JAW_MID, ZYGOMATIC, CHIN_SIDE } from '../landmarks'
import { prominence, type FaceFrame } from '../normalize'
import { pctStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

/** 下颌轮廓：颧 → 下颌角 → 颌中 → 颏侧，两侧各取一串 */
const JAW_CHAIN = {
  left: [ZYGOMATIC.left, GONION.left, JAW_MID.left, CHIN_SIDE.left],
  right: [ZYGOMATIC.right, GONION.right, JAW_MID.right, CHIN_SIDE.right],
} as const

/** 颊部中心附近，用来量外鼓 */
const CHEEK = { left: [425, 280, 352], right: [205, 50, 123] } as const

const SPECS: FeatureSpec[] = [
  {
    id: 'face3d.boneFlesh.jawAngularity',
    label: '颌线转折',
    category: '骨肉',
    unit: 'score',
    method: 'contour',
    source: '太清神鉴',
    describe: '下颌轮廓在下颌角处的转折锐度，0–1。高 = 转折硬朗，偏骨',
  },
  {
    id: 'face3d.boneFlesh.cheekFullness',
    label: '颊部外鼓',
    category: '骨肉',
    unit: 'iod',
    method: 'shading',
    source: '太清神鉴',
    describe: '颊部相对「颧—颌角」连线的外鼓量。鼓即有肉，凹即见骨',
  },
  {
    id: 'face3d.boneFlesh.index',
    label: '骨肉指数',
    category: '骨肉',
    unit: 'score',
    method: 'contour',
    source: '太清神鉴',
    describe: '0–1 的合成代理，高 = 骨多肉少，低 = 骨少肉多，0.5 附近为骨肉相称',
  },
]

export const boneFleshModule: FeatureModule = {
  name: 'boneFlesh',
  specs: SPECS,
  compute(frame: FaceFrame): Measurement[] {
    const P = frame.points

    /* ---- 颌线转折：下颌角处两段的夹角 ---- */
    const angleAtGonion = (chain: readonly number[]): number => {
      const a = norm3(sub3(P[chain[0]], P[chain[1]]))
      const b = norm3(sub3(P[chain[2]], P[chain[1]]))
      const cos = Math.max(-1, Math.min(1, dot3(a, b)))
      return (Math.acos(cos) * 180) / Math.PI
    }
    const gonialAngle = (angleAtGonion(JAW_CHAIN.left) + angleAtGonion(JAW_CHAIN.right)) / 2
    // 90° 视为极方硬、160° 视为极圆润，中间线性
    const angularity = clamp01((160 - gonialAngle) / 70)

    /* ---- 颊部外鼓：颊心相对「颧—颌角」连线的偏移 ---- */
    const bulgeOf = (side: 'left' | 'right'): number => {
      const zyg = P[ZYGOMATIC[side]]
      const gon = P[GONION[side]]
      const axis = sub3(gon, zyg)
      const axisLen = len3(axis) || 1
      const u = { x: axis.x / axisLen, y: axis.y / axisLen, z: axis.z / axisLen }
      const cheek = CHEEK[side].map((i) => P[i])
      const c = {
        x: cheek.reduce((s, p) => s + p.x, 0) / cheek.length,
        y: cheek.reduce((s, p) => s + p.y, 0) / cheek.length,
        z: cheek.reduce((s, p) => s + p.z, 0) / cheek.length,
      }
      const d = sub3(c, zyg)
      const along = dot3(d, u)
      const perp = sub3(d, { x: u.x * along, y: u.y * along, z: u.z * along })
      return dot3(perp, frame.facePlane.normal)
    }
    const cheekFullness = (bulgeOf('left') + bulgeOf('right')) / 2

    /* ---- 合成 ----
     * 颊鼓 8% IOD 记为「很有肉」。两项各占一半，方向相反。 */
    const fleshiness = clamp01(cheekFullness / 0.08)
    const index = clamp01(0.5 * angularity + 0.5 * (1 - fleshiness))

    // 颧部前突拿来给证据加一句：骨感的脸颧骨往往更立
    const zygo = prominence(frame, [ZYGOMATIC.left, ZYGOMATIC.right])

    return [
      {
        specId: 'face3d.boneFlesh.jawAngularity',
        value: round3(angularity),
        evidence: `下颌角实测 ${gonialAngle.toFixed(0)}°（越小越方硬）`,
      },
      {
        specId: 'face3d.boneFlesh.cheekFullness',
        value: round3(cheekFullness),
        evidence: `颊心相对颧—颌角连线外鼓 ${(cheekFullness * 100).toFixed(1)}% IOD，颧部前突 ${(zygo * 100).toFixed(1)}% IOD`,
        factor: frame.poseFactor,
        status: 'inferred',
      },
      {
        specId: 'face3d.boneFlesh.index',
        value: round3(index),
        evidence: `颌线转折 ${pctStr(angularity)}、颊部丰盈 ${pctStr(fleshiness)} 合成；0.5 附近为骨肉相称`,
        factor: frame.poseFactor,
        status: 'inferred',
      },
    ]
  },
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
