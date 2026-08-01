/**
 * 用 MediaPipe 官方的规范人脸网格（canonical_face_model，468 顶点）反向验证
 * landmarks.ts 里的每一个索引 —— 靠几何性质证明，而不是靠记忆。
 *
 * 规范模型坐标系：x 向被摄者左侧为正，**y 向上为正**，z 向前（朝镜头）为正。
 * 注意这与图像坐标系的 y 方向相反，下面的断言按规范模型的方向写。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import {
  BROW,
  CHIN_BOTTOM,
  EYE,
  FACE_OVAL,
  FACE_WIDEST,
  FOREHEAD_TOP,
  GLABELLA,
  GONION,
  IRIS,
  MIDLINE,
  MIRROR_PAIRS,
  MOUTH,
  NOSE,
  NOSE_TIP,
  SUBNASALE,
  UPPER_LIP_OUTER,
  ZYGOMATIC,
} from '../landmarks'

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/canonical-face-model.json', import.meta.url)),
    'utf8',
  ),
) as { vertices: [number, number, number][] }

const V = fixture.vertices
const X = (i: number) => V[i][0]
const Y = (i: number) => V[i][1]
const Z = (i: number) => V[i][2]

/** 只有前 468 点在规范模型里；虹膜 468–477 由 attention 模型另外产生 */
const MESH_N = 468

function argmax(fn: (i: number) => number): number {
  let best = 0
  for (let i = 1; i < MESH_N; i++) if (fn(i) > fn(best)) best = i
  return best
}

describe('规范网格本身', () => {
  it('468 个顶点', () => {
    expect(V).toHaveLength(MESH_N)
  })
})

describe('面部中轴', () => {
  it('FOREHEAD_TOP 是全网格最高点', () => {
    expect(argmax(Y)).toBe(FOREHEAD_TOP)
  })

  it('CHIN_BOTTOM 是全网格最低点', () => {
    expect(argmax((i) => -Y(i))).toBe(CHIN_BOTTOM)
  })

  it('NOSE_TIP 是全网格最前突的点', () => {
    expect(argmax(Z)).toBe(NOSE_TIP)
  })

  it('所有中轴点的 x 都为 0', () => {
    for (const i of MIDLINE) expect(Math.abs(X(i))).toBeLessThan(1e-6)
  })

  it('中轴点自上而下严格递减', () => {
    for (let k = 1; k < MIDLINE.length; k++) {
      expect(Y(MIDLINE[k])).toBeLessThan(Y(MIDLINE[k - 1]))
    }
  })

  it('SUBNASALE 在鼻尖下方、上唇上方 —— 这是三停「中停」的下边界', () => {
    expect(Y(SUBNASALE)).toBeLessThan(Y(NOSE_TIP))
    expect(Y(SUBNASALE)).toBeGreaterThan(Y(UPPER_LIP_OUTER))
  })

  it('GLABELLA（印堂）位于两眉头之间的高度', () => {
    const browInnerY = (Y(BROW.left.inner) + Y(BROW.right.inner)) / 2
    const browInnerTopY = (Y(BROW.left.innerTop) + Y(BROW.right.innerTop)) / 2
    expect(Y(GLABELLA)).toBeGreaterThan(browInnerY)
    expect(Y(GLABELLA)).toBeLessThan(browInnerTopY + 0.5)
  })
})

describe('眼', () => {
  it('LEFT 在 x 正侧，RIGHT 在 x 负侧（与 MediaPipe 官方命名一致）', () => {
    expect(X(EYE.left.outer)).toBeGreaterThan(0)
    expect(X(EYE.right.outer)).toBeLessThan(0)
  })

  it('外眦比内眦更远离中线', () => {
    expect(X(EYE.left.outer)).toBeGreaterThan(X(EYE.left.inner))
    expect(X(EYE.right.outer)).toBeLessThan(X(EYE.right.inner))
  })

  it('上睑高于下睑', () => {
    expect(Y(EYE.left.upper)).toBeGreaterThan(Y(EYE.left.lower))
    expect(Y(EYE.right.upper)).toBeGreaterThan(Y(EYE.right.lower))
  })

  it('左右眼严格镜像', () => {
    expect(X(EYE.left.outer)).toBeCloseTo(-X(EYE.right.outer), 4)
    expect(Y(EYE.left.outer)).toBeCloseTo(Y(EYE.right.outer), 4)
  })

  it('虹膜索引落在 468–477 区间（规范网格之外）', () => {
    for (const i of [IRIS.left.center, IRIS.right.center, ...IRIS.left.ring, ...IRIS.right.ring]) {
      expect(i).toBeGreaterThanOrEqual(468)
      expect(i).toBeLessThanOrEqual(477)
    }
  })
})

describe('眉', () => {
  it('inner 是该侧眉中最靠中线的点', () => {
    for (const i of BROW.left.all) expect(X(BROW.left.inner)).toBeLessThanOrEqual(X(i))
    for (const i of BROW.right.all) expect(X(BROW.right.inner)).toBeGreaterThanOrEqual(X(i))
  })

  it('outer 是该侧眉中最远离中线的点', () => {
    for (const i of BROW.left.all) expect(X(BROW.left.outer)).toBeGreaterThanOrEqual(X(i))
    for (const i of BROW.right.all) expect(X(BROW.right.outer)).toBeLessThanOrEqual(X(i))
  })

  it('innerTop 高于 inner —— 前者是眉头上缘，后者才是眉头', () => {
    expect(Y(BROW.left.innerTop)).toBeGreaterThan(Y(BROW.left.inner))
    expect(Y(BROW.right.innerTop)).toBeGreaterThan(Y(BROW.right.inner))
  })

  it('眉整体高于同侧眼', () => {
    const browY = BROW.right.all.reduce((s, i) => s + Y(i), 0) / BROW.right.all.length
    expect(browY).toBeGreaterThan(Y(EYE.right.upper))
  })
})

describe('鼻', () => {
  it('鼻翼外缘是鼻底高度处 x 绝对值最大的点', () => {
    const atBase = (i: number) => Y(i) > -2.6 && Y(i) < -0.8 && Z(i) > 4.6
    let bestL = -1
    let bestR = -1
    for (let i = 0; i < MESH_N; i++) {
      if (!atBase(i)) continue
      if (X(i) > 0 && (bestL < 0 || X(i) > X(bestL))) bestL = i
      if (X(i) < 0 && (bestR < 0 || X(i) < X(bestR))) bestR = i
    }
    expect(bestL).toBe(NOSE.alarLeft)
    expect(bestR).toBe(NOSE.alarRight)
  })

  it('鼻翼外缘确实比常被误用的 48/278 更外侧', () => {
    expect(Math.abs(X(NOSE.alarLeft))).toBeGreaterThan(Math.abs(X(278)))
    expect(Math.abs(X(NOSE.alarRight))).toBeGreaterThan(Math.abs(X(48)))
  })

  it('鼻梁自山根到鼻尖单调前突', () => {
    for (let k = 1; k < NOSE.bridge.length; k++) {
      expect(Z(NOSE.bridge[k])).toBeGreaterThan(Z(NOSE.bridge[k - 1]))
    }
  })

  it('鼻孔点低于鼻翼外缘', () => {
    expect(Y(NOSE.nostrilLeft)).toBeLessThan(Y(NOSE.alarLeft))
    expect(Y(NOSE.nostrilRight)).toBeLessThan(Y(NOSE.alarRight))
  })
})

describe('口', () => {
  it('口角是唇部 x 的两个极值', () => {
    expect(X(MOUTH.cornerLeft)).toBeGreaterThan(0)
    expect(X(MOUTH.cornerRight)).toBeLessThan(0)
    expect(X(MOUTH.cornerLeft)).toBeCloseTo(-X(MOUTH.cornerRight), 4)
  })

  it('唇的四个中轴点自上而下有序', () => {
    expect(Y(MOUTH.upperOuter)).toBeGreaterThan(Y(MOUTH.upperInner))
    expect(Y(MOUTH.upperInner)).toBeGreaterThan(Y(MOUTH.lowerInner))
    expect(Y(MOUTH.lowerInner)).toBeGreaterThan(Y(MOUTH.lowerOuter))
  })

  it('唇峰在上唇中点两侧且更高', () => {
    const [a, b] = MOUTH.cupidBow
    expect(X(a) * X(b)).toBeLessThan(0)
    expect(Y(a)).toBeGreaterThan(Y(MOUTH.upperOuter))
  })
})

describe('面部轮廓', () => {
  it('FACE_WIDEST 是全网格 x 绝对值最大的一对', () => {
    expect(argmax(X)).toBe(FACE_WIDEST.left)
    expect(argmax((i) => -X(i))).toBe(FACE_WIDEST.right)
  })

  it('FACE_WIDEST 确实比常被误用的 234/454 更宽', () => {
    expect(Math.abs(X(FACE_WIDEST.left))).toBeGreaterThan(Math.abs(X(ZYGOMATIC.left)))
  })

  it('下颌角低于颧点、且比下巴更宽', () => {
    expect(Y(GONION.left)).toBeLessThan(Y(ZYGOMATIC.left))
    expect(Math.abs(X(GONION.left))).toBeGreaterThan(Math.abs(X(CHIN_BOTTOM)))
  })

  it('FACE_OVAL 是官方的 36 点闭合轮廓，且首点为额顶、含下巴', () => {
    expect(FACE_OVAL).toHaveLength(36)
    expect(new Set(FACE_OVAL).size).toBe(36)
    expect(FACE_OVAL[0]).toBe(FOREHEAD_TOP)
    expect(FACE_OVAL).toContain(CHIN_BOTTOM)
  })
})

describe('镜像点对', () => {
  it('每一对都严格左右对称', () => {
    for (const [l, r] of MIRROR_PAIRS) {
      expect(X(l)).toBeCloseTo(-X(r), 3)
      expect(Y(l)).toBeCloseTo(Y(r), 3)
      expect(Z(l)).toBeCloseTo(Z(r), 3)
    }
  })

  it('左侧点的 x 恒为正', () => {
    for (const [l] of MIRROR_PAIRS) expect(X(l)).toBeGreaterThan(0)
  })
})
