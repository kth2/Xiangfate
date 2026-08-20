/**
 * 骨肉代理（几何版）。
 *
 * 「骨为君，肉为臣」——骨相把骨与肉的比例看得比任何单项都重。
 * 但照片测不到骨。骨相模块现有的做法是拿**像素轮廓锐度**近似，
 * 那受光照影响极大；这里给一个纯几何的、与光照无关的代理，两者互为参照。
 *
 * 三个代理量：
 *   · jawAngularity  下颌轮廓的转折锐度 —— 骨感的脸转折硬，肉感的脸转折圆
 *   · cheekFullness  颊部中段相对自身上下缘连线的矢高 —— 鼓即有肉，凹即见骨
 *   · boneFleshIndex 两者合成，高 = 骨多肉少
 *
 * ⚠️ 这是**代理**，不是测量：胖瘦、年龄、表情都会影响它。
 * 因此以 inferred 出具，且措辞里必须带上推估。
 */

import { dot3, norm3, sub3 } from '@/core/vec3'
import { CHEEK_COLUMN, GONION, JAW_MID, ZYGOMATIC, CHIN_SIDE } from '../landmarks'
import { prominence, type FaceFrame } from '../normalize'
import { pctStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

/** 下颌轮廓：颧 → 下颌角 → 颌中 → 颏侧，两侧各取一串 */
const JAW_CHAIN = {
  left: [ZYGOMATIC.left, GONION.left, JAW_MID.left, CHIN_SIDE.left],
  right: [ZYGOMATIC.right, GONION.right, JAW_MID.right, CHIN_SIDE.right],
} as const

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
    describe: '颊部中段相对「颊上缘—颊下缘」连线的矢高。正 = 外鼓有肉，负 = 内凹见骨',
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

    /* ---- 颊部外鼓：颊部自身的矢高 ----
     *
     * ⚠️ 这里曾经量错过，值得记一笔。原做法是「颊心相对**颧—颌角**连线的偏移」，
     * 而 ZYGOMATIC 与 GONION 都在 FACE_OVAL 上，属侧廓：规范帧里颧在面平面后
     * 39% IOD、颌角后 13%。于是拿侧廓连线去量正面颊部，量到的其实是
     * **脸的前后厚度** —— 每张脸都有约 54% IOD，而归一化分母写的是 8%，
     * 于是 fleshiness 恒为 1.0，骨肉指数退化成只由颌线转折决定。
     * 两张实测脸都因此落进「肉胜于骨」。
     *
     * 现在改为在**同一片正面颊部**上取矢高 —— 与 nose.dorsumConvexity
     * 量鼻梁曲直是同一套办法：上下两点连成弦，中点高出弦多少即为鼓。
     * 正 = 外鼓有肉，负 = 内凹见骨，与光照无关，也与脸的厚薄无关。
     */
    const sagittaOf = (side: 'left' | 'right'): number => {
      const c = CHEEK_COLUMN[side]
      const prom = (i: number) => dot3(sub3(P[i], frame.facePlane.point), frame.facePlane.normal)
      const span = P[c.lower].y - P[c.upper].y
      // 中点在弦上的位置，按 y 线性插值；退化时取中
      const t = Math.abs(span) > 1e-6 ? clamp01((P[c.mid].y - P[c.upper].y) / span) : 0.5
      const chord = prom(c.upper) + t * (prom(c.lower) - prom(c.upper))
      return prom(c.mid) - chord
    }
    const cheekFullness = (sagittaOf('left') + sagittaOf('right')) / 2

    /* ---- 合成 ----
     * 0 = 颊平（弦上无起伏，骨形直接显出来）；上端取 12% IOD 记为「很有肉」。
     * ⚠️ CALIBRATE：下端 0 有明确含义，上端没有 —— 12% 是照矢高的量纲挑的，
     * 只保证实测值落在刻度内而不贴边（规范脸 5.9%、真人脸 9.3%）。
     * 真实人群到手后应按分位重设。real-face.test.ts 有一条通用的饱和检查守着，
     * 正是它当初漏掉了这一项。 */
    const fleshiness = clamp01(cheekFullness / 0.12)
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
        evidence: `颊部中段相对上下缘连线的矢高 ${(cheekFullness * 100).toFixed(1)}% IOD（正为鼓、负为凹），颧部前突 ${(zygo * 100).toFixed(1)}% IOD`,
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
