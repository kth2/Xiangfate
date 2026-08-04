/**
 * 三维对称性。
 *
 * 旧实现是二维的：把镜像点对沿一条拟合中线翻过去比距离。
 * 问题在于**深度方向的不对称完全看不见** —— 一侧颧骨更靠前、一侧眼窝更深，
 * 投影到画面上可能仍然左右等距。
 *
 * 这里改成：拟合中矢面，把左侧点整体镜像到右侧，量三维残差。
 *
 * ⚠️ 边界：明显的面部不对称常源于医学状况（面瘫、外伤、先天差异）。
 * 这一项只出数值与「左右各有其势」这类中性描述，**不据以论人格** ——
 * 见 docs/07 里「嘴歪眼斜→为人狡诈」那条，它是被明确删掉的。
 */

import { dist3d, reflectAcrossPlane } from '@/core/vec3'
import { median } from '@/core/geom'
import { MIRROR_PAIRS } from '../landmarks'
import { depthOf, type FaceFrame } from '../normalize'
import { iodStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

const SPECS: FeatureSpec[] = [
  {
    id: 'face3d.symmetry.score',
    label: '三维对称度',
    category: '对称',
    unit: 'score',
    method: 'geometry',
    source: '麻衣神相',
    describe: '镜像点对经中矢面翻转后的三维残差中位数，换算成 0–1；1 为完全对称',
  },
  {
    id: 'face3d.symmetry.depthBias',
    label: '深度偏侧',
    category: '对称',
    unit: 'iod',
    method: 'shading',
    source: null,
    describe: '左右两侧沿帧 z 轴的平均前突之差。正 = 被摄者左侧更靠前 —— 二维对称度完全看不出这一项',
  },
  {
    id: 'face3d.symmetry.maxResidual',
    label: '最大不对称',
    category: '对称',
    unit: 'iod',
    method: 'geometry',
    source: null,
    describe: '残差最大的那一对镜像点的距离，用于指出偏在哪儿',
  },
]

export const symmetry3dModule: FeatureModule = {
  name: 'symmetry3d',
  specs: SPECS,
  compute(frame: FaceFrame): Measurement[] {
    const P = frame.points
    const plane = frame.midsagittal

    const residuals: { pair: [number, number]; d: number }[] = []
    let depthL = 0
    let depthR = 0

    for (const [l, r] of MIRROR_PAIRS) {
      const mirrored = reflectAcrossPlane(P[l], plane)
      residuals.push({ pair: [l, r], d: dist3d(mirrored, P[r]) })
      /*
       * 深度沿**帧的 z 轴**量，不用拟合的面平面。
       * 面平面是拿包括这些点在内的轮廓拟合出来的 —— 一侧真的更靠前时，
       * 平面会跟着转过去，测出来的偏侧几乎为零，等于自己减自己。
       * 帧的 z 轴由眼角与额-颏连线定义，不参与拟合，因此不会被带偏。
       */
      depthL += depthOf(P[l])
      depthR += depthOf(P[r])
    }

    const n = MIRROR_PAIRS.length || 1
    const med = median(residuals.map((x) => x.d))
    const worst = residuals.reduce((a, b) => (b.d > a.d ? b : a), residuals[0])

    // 残差 10% IOD 记为完全不对称 —— 真实人脸的中位残差通常在 1–3% 之间
    const score = Math.max(0, 1 - med / 0.1)
    const depthBias = depthL / n - depthR / n

    return [
      {
        specId: 'face3d.symmetry.score',
        value: round3(score),
        evidence: `${MIRROR_PAIRS.length} 组镜像点经中矢面翻转后，三维残差中位数 ${iodStr(med)}`,
      },
      {
        specId: 'face3d.symmetry.depthBias',
        value: round3(depthBias),
        evidence: `左侧平均前突 ${iodStr(depthL / n)}，右侧 ${iodStr(depthR / n)}，相差 ${iodStr(Math.abs(depthBias))}`,
        factor: frame.poseFactor,
        status: 'inferred',
      },
      {
        specId: 'face3d.symmetry.maxResidual',
        value: round3(worst?.d ?? 0),
        evidence: `最大残差出现在关键点 ${worst?.pair[0]}/${worst?.pair[1]}，${iodStr(worst?.d ?? 0)}`,
      },
    ]
  },
}
