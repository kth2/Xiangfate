/**
 * 十二宫的基础统计：面积、深度、左右对称。
 *
 * 旧实现只对四个宫给了「高/低」，其余八宫在数据里根本不存在 ——
 * 报告里谈十二宫只能靠模型自由发挥。这里把十二宫**逐宫量出来**：
 *   · area     —— 宫位多边形在帧内的面积（IOD²），对应「广狭」
 *   · depth    —— 相对面平面的平均前突（IOD），对应「丰陷」
 *   · symmetry —— 成对宫位的左右一致度（单侧宫位为 null）
 *
 * ⚠️ landmarks.ts 的 PALACE_REGIONS 原本只有十一宫，缺夫妻宫（奸门）——
 * 也就是说「十二宫」一直只有十一宫。这里补齐，采样区取眼尾外侧那一小块。
 */

import { centroid3, dot3, polygonArea3, sub3 } from '@/core/vec3'
import { PALACE_REGIONS, type PalaceKey } from '../landmarks'
import { prominence, type FaceFrame } from '../normalize'
import type { Palace } from '@/core/types'
import { iodStr, round3, type FeatureModule, type FeatureSpec, type Measurement } from './types'

/** 宫位名 → 稳定的英文 id 片段。**id 一旦发布就不能改** */
const PALACE_ID: Record<string, string> = {
  命宫: 'ming',
  财帛宫: 'caibo',
  兄弟宫: 'xiongdi',
  田宅宫: 'tianzhai',
  男女宫: 'nannv',
  疾厄宫: 'jie',
  夫妻宫: 'fuqi',
  迁移宫: 'qianyi',
  奴仆宫: 'nupu',
  官禄宫: 'guanlu',
  福德宫: 'fude',
  父母宫: 'fumu',
}

const ALL_PALACES: Palace[] = [
  '命宫', '财帛宫', '兄弟宫', '田宅宫', '男女宫', '疾厄宫',
  '夫妻宫', '迁移宫', '奴仆宫', '官禄宫', '福德宫', '父母宫',
]

/** 夫妻宫（奸门）：眼尾外侧那一小块。PALACE_REGIONS 里没有，单独定义 */
const QIMEN = {
  left: [263, 359, 446, 342, 353],
  right: [33, 130, 226, 113, 124],
} as const

/**
 * 成对宫位的**另一侧**采样区。
 * PALACE_REGIONS 给的都是右侧（图像左半），这里补对应的左侧，用来算左右一致度。
 */
const MIRRORED: Partial<Record<Palace, readonly number[]>> = {
  兄弟宫: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  田宅宫: [336, 296, 334, 293, 300, 263, 386, 362],
  男女宫: [263, 374, 362, 350, 357],
  迁移宫: [251, 284, 332, 297, 338, 10],
  奴仆宫: [397, 365, 379, 378, 400, 377, 152],
  福德宫: [300, 293, 334, 296, 336, 151, 337],
}

const SPECS: FeatureSpec[] = ALL_PALACES.map((name) => ({
  id: `face3d.palace.${PALACE_ID[name]}`,
  label: name,
  category: '十二宫',
  unit: 'iod',
  method: 'shading',
  source: '麻衣神相',
  describe: `${name}的面积、相对面平面的前突，以及（成对宫位的）左右一致度`,
}))

export interface PalaceStat {
  palace: Palace
  /** IOD² */
  area: number
  /** IOD，正 = 前突 */
  depth: number
  /** 成对宫位才有 */
  symmetry: number | null
}

export const palacesModule: FeatureModule = {
  name: 'palaces',
  specs: SPECS,
  compute(frame: FaceFrame): Measurement[] {
    return allPalaceStats(frame).map((s) => ({
      specId: `face3d.palace.${PALACE_ID[s.palace]}`,
      // 主值取深度 —— 十二宫的传统论断里「丰/陷」比「广/狭」更常被引用
      value: s.depth,
      evidence:
        `面积 ${s.area.toFixed(3)} IOD²，相对面平面${s.depth >= 0 ? '前突' : '内陷'} ${iodStr(Math.abs(s.depth))}` +
        (s.symmetry === null ? '' : `，左右一致度 ${s.symmetry.toFixed(2)}`),
      factor: frame.poseFactor,
      status: 'inferred',
    }))
  },
}

/** 全量统计。报告里只放主值，完整数据走 raw，供 AI 与调试查阅 */
export function allPalaceStats(frame: FaceFrame): PalaceStat[] {
  return ALL_PALACES.map((name) => {
    const idx = name === '夫妻宫' ? QIMEN.right : PALACE_REGIONS[name as PalaceKey]
    const area = polygonArea3(idx.map((i) => frame.points[i]))
    const depth = prominence(frame, idx)

    const otherSide = name === '夫妻宫' ? QIMEN.left : MIRRORED[name]
    let symmetry: number | null = null
    if (otherSide) {
      const a = regionDepth(frame, idx)
      const b = regionDepth(frame, otherSide)
      const hi = Math.max(Math.abs(a), Math.abs(b))
      symmetry = hi > 1e-6 ? Math.max(0, 1 - Math.abs(a - b) / (hi * 2)) : 1
    }

    return {
      palace: name,
      area: round3(area),
      depth: round3(depth),
      symmetry: symmetry === null ? null : round3(symmetry),
    }
  })
}

/** 区域质心相对面平面的前突 */
function regionDepth(frame: FaceFrame, idx: readonly number[]): number {
  const c = centroid3(idx.map((i) => frame.points[i]))
  return dot3(sub3(c, frame.facePlane.point), frame.facePlane.normal)
}
