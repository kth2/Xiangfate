/**
 * 命宫（印堂）。两眉之间那块，传统视为一身气之所聚 ——
 * 宽窄看心量、明晦看当下、而**丰陷**只有 3D 才量得出来。
 *
 * 「印堂饱满」与「印堂凹陷」在正面照里几乎是同一张图，
 * 区别全在深度：前者相对眉骨—山根一线向前鼓，后者向后陷。
 */

import { dot3, len3, sub3 } from '@/core/vec3'
import { BROW, GLABELLA, NASAL_ROOT } from '../landmarks'
import { eyeWidth, type FaceFrame } from '../normalize'
import { iodStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

const SPECS: FeatureSpec[] = [
  {
    id: 'face3d.mingGong.width',
    label: '印堂宽',
    category: '十二宫',
    unit: 'ratio',
    method: 'geometry',
    source: '麻衣神相',
    describe: '两眉头间距 ÷ 单眼宽。传统以「一指半至两指」为宽',
  },
  {
    id: 'face3d.mingGong.fullness',
    label: '印堂丰陷',
    category: '十二宫',
    unit: 'iod',
    method: 'shading',
    source: '麻衣神相',
    describe: '印堂相对「两眉头 + 山根」三点所成基准的前突量。正 = 饱满，负 = 凹陷',
  },
  {
    id: 'face3d.mingGong.symmetry',
    label: '印堂左右均衡',
    category: '十二宫',
    unit: 'score',
    method: 'geometry',
    source: null,
    describe: '两眉头到中矢面的距离之比，1 为完全对称',
  },
]

export const mingGongModule: FeatureModule = {
  name: 'mingGong',
  specs: SPECS,
  compute(frame: FaceFrame): Measurement[] {
    const P = frame.points
    const browL = P[BROW.left.inner]
    const browR = P[BROW.right.inner]

    const gap = len3(sub3(browL, browR))
    const eye = eyeWidth(frame)
    const width = eye > 1e-6 ? gap / eye : 0

    /* ---- 丰陷：以两眉头与山根构成的局部基准面为零点 ----
     * 不用整张面平面，是因为印堂本来就位于面平面之前，
     * 拿全脸基准量出来的永远是正数，分不出饱满与凹陷。 */
    const basis = {
      x: (browL.x + browR.x + P[NASAL_ROOT].x) / 3,
      y: (browL.y + browR.y + P[NASAL_ROOT].y) / 3,
      z: (browL.z + browR.z + P[NASAL_ROOT].z) / 3,
    }
    const fullness = dot3(sub3(P[GLABELLA], basis), frame.facePlane.normal)

    /* ---- 左右均衡 ---- */
    const dL = Math.abs(dot3(sub3(browL, frame.midsagittal.point), frame.midsagittal.normal))
    const dR = Math.abs(dot3(sub3(browR, frame.midsagittal.point), frame.midsagittal.normal))
    const symmetry = Math.max(dL, dR) > 1e-6 ? Math.min(dL, dR) / Math.max(dL, dR) : 1

    return [
      {
        specId: 'face3d.mingGong.width',
        value: round3(width),
        evidence: `两眉头间距为单眼宽的 ${width.toFixed(2)} 倍`,
      },
      {
        specId: 'face3d.mingGong.fullness',
        value: round3(fullness),
        evidence: `印堂相对两眉头与山根的基准${fullness >= 0 ? '前突' : '内陷'} ${iodStr(Math.abs(fullness))}`,
        factor: frame.poseFactor,
        status: 'inferred',
      },
      {
        specId: 'face3d.mingGong.symmetry',
        value: round3(symmetry),
        evidence: `两眉头离中矢面 ${iodStr(dR)} / ${iodStr(dL)}`,
      },
    ]
  },
}
