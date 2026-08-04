/**
 * 3D 特征管线（schema 2.0，Phase 1）。
 *
 * 最要紧的一条是**姿态不变性**：同一张脸转过一个角度，规范帧应当把它转回来，
 * 于是所有特征基本不动。这是「3D 化」相对旧的二维实现真正的增益 ——
 * 如果这条不成立，那这一层就只是把噪声换了个坐标系。
 */

import { describe, expect, it } from 'vitest'
import type { P3 } from '@/core/geom'
import { dist3d, dot3, len3, sub3 } from '@/core/vec3'
import { buildFaceFrame, eyeWidth, prominence } from '../normalize'
import { computeFace3DFeatures, FEATURE_MODULES, FEATURE_REGISTRY } from '../features'
import { allPalaceStats } from '../features/palaces'
import { NOSE_TIP, ZYGOMATIC } from '../landmarks'
import { IMG_H, IMG_W, projectCanonical } from './canonical'

const LM = projectCanonical()

/** 绕三轴旋转点云（与 robustness.test.ts 同一套），用来模拟拍歪了 */
function rotate(lm: P3[], { yaw = 0, pitch = 0, roll = 0 }): P3[] {
  const rad = (d: number) => (d * Math.PI) / 180
  const [cy, sy] = [Math.cos(rad(yaw)), Math.sin(rad(yaw))]
  const [cp, sp] = [Math.cos(rad(pitch)), Math.sin(rad(pitch))]
  const [cr, sr] = [Math.cos(rad(roll)), Math.sin(rad(roll))]
  const cx0 = lm.reduce((s, p) => s + p.x, 0) / lm.length
  const cy0 = lm.reduce((s, p) => s + p.y, 0) / lm.length

  return lm.map((p) => {
    let x = (p.x - cx0) * IMG_W
    let y = (p.y - cy0) * IMG_H
    let z = p.z * IMG_W
    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    ;[y, z] = [y * cp - z * sp, y * sp + z * cp]
    ;[x, y] = [x * cr - y * sr, x * sr + y * cr]
    return { x: cx0 + x / IMG_W, y: cy0 + y / IMG_H, z: z / IMG_W }
  })
}

const frameOf = (lm: P3[]) => buildFaceFrame({ landmarks: lm, imgWidth: IMG_W, imgHeight: IMG_H })
const BASE = frameOf(LM)

const valuesOf = (lm: P3[]): Map<string, number> => {
  const r = computeFace3DFeatures({
    landmarks: lm,
    imgWidth: IMG_W,
    imgHeight: IMG_H,
    qualityFactor: 0.9,
    detectorScore: 0.95,
  })
  return new Map(r.features.map((f) => [f.id, f.value as number]))
}

describe('规范帧', () => {
  it('原点在双外眦中点，IOD 为 1', () => {
    const P = BASE.points
    const outerL = P[263]
    const outerR = P[33]
    expect(len3(sub3(outerL, outerR))).toBeCloseTo(1, 6)
    expect((outerL.x + outerR.x) / 2).toBeCloseTo(0, 6)
    expect((outerL.y + outerR.y) / 2).toBeCloseTo(0, 6)
  })

  it('x 轴指向被摄者左侧', () => {
    expect(BASE.points[263].x).toBeGreaterThan(BASE.points[33].x)
  })

  it('鼻尖是全脸相对面平面最靠前的点之一', () => {
    const tip = prominence(BASE, [NOSE_TIP])
    const cheek = prominence(BASE, [ZYGOMATIC.left, ZYGOMATIC.right])
    expect(tip).toBeGreaterThan(cheek)
  })

  it('中矢面法向指向 +x，且鼻尖几乎落在面上', () => {
    expect(BASE.midsagittal.normal.x).toBeGreaterThan(0.9)
    const d = dot3(sub3(BASE.points[NOSE_TIP], BASE.midsagittal.point), BASE.midsagittal.normal)
    expect(Math.abs(d)).toBeLessThan(0.05)
  })

  it('没有姿态矩阵时给保守折扣，有则按角度折算', () => {
    expect(BASE.poseKnown).toBe(false)
    expect(BASE.poseFactor).toBeCloseTo(0.85, 5)

    // 单位阵 = 正对镜头
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const f = buildFaceFrame({ landmarks: LM, imgWidth: IMG_W, imgHeight: IMG_H, transformMatrix: identity })
    expect(f.poseKnown).toBe(true)
    expect(f.poseFactor).toBe(1)
  })
})

describe('姿态不变性 —— 这一层存在的理由', () => {
  const cases: [string, P3[]][] = [
    ['yaw 12°', rotate(LM, { yaw: 12 })],
    ['pitch 10°', rotate(LM, { pitch: 10 })],
    ['roll 15°', rotate(LM, { roll: 15 })],
    ['三轴同时转', rotate(LM, { yaw: 8, pitch: 6, roll: 10 })],
  ]

  const base = valuesOf(LM)

  it.each(cases)('%s 之后所有特征基本不变', (_n, lm) => {
    const got = valuesOf(lm)
    for (const [id, v] of base) {
      const after = got.get(id)!
      // 绝对值很小的量用绝对误差比，否则相对误差会放大噪声
      const tol = Math.max(0.02, Math.abs(v) * 0.1)
      expect(Math.abs(after - v), `${id}: ${v} → ${after}`).toBeLessThan(tol)
    }
  })

  it('等比缩放完全不影响 —— 一切都以 IOD 为单位', () => {
    const scaled = LM.map((p) => ({ x: 0.5 + (p.x - 0.5) * 1.3, y: 0.5 + (p.y - 0.5) * 1.3, z: p.z * 1.3 }))
    const got = valuesOf(scaled)
    for (const [id, v] of valuesOf(LM)) {
      expect(Math.abs(got.get(id)! - v), id).toBeLessThan(0.01)
    }
  })

  it('对比之下：不做规范化的话，转头会明显改变颧骨前突', () => {
    // 直接在图像坐标里量「鼻尖 z − 颧骨 z」，不经规范帧
    const rawDepth = (lm: P3[]) => lm[NOSE_TIP].z - (lm[ZYGOMATIC.left].z + lm[ZYGOMATIC.right].z) / 2
    const drift = Math.abs(rawDepth(rotate(LM, { yaw: 12 })) - rawDepth(LM))
    expect(drift).toBeGreaterThan(0)
  })
})

describe('注册表', () => {
  const all = FEATURE_MODULES.flatMap((m) => m.specs)

  it('id 全局唯一', () => {
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length)
  })

  it('id 一律以 face3d. 开头，便于与二维特征区分', () => {
    for (const s of all) expect(s.id.startsWith('face3d.')).toBe(true)
  })

  it('每条 spec 都被实际产出，没有登记了却算不出来的', () => {
    const produced = new Set(
      FEATURE_MODULES.flatMap((m) => m.compute(BASE)).map((x) => x.specId),
    )
    for (const s of all) expect(produced.has(s.id), `${s.id} 没有被产出`).toBe(true)
  })

  it('每条产出都能在注册表里找到 spec', () => {
    for (const m of FEATURE_MODULES) {
      for (const x of m.compute(BASE)) {
        expect(FEATURE_REGISTRY.has(x.specId), `${x.specId} 未登记`).toBe(true)
      }
    }
  })

  it('每条 spec 都写了 label、单位与说明', () => {
    for (const s of all) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.describe.length).toBeGreaterThan(5)
      expect(['iod', 'ratio', 'deg', 'score', 'none']).toContain(s.unit)
    }
  })
})

describe('产出的特征形状', () => {
  const result = computeFace3DFeatures({
    landmarks: LM,
    imgWidth: IMG_W,
    imgHeight: IMG_H,
    qualityFactor: 0.9,
    detectorScore: 0.95,
  })

  it('每条都带 id / label / value / unit / status / confidence / evidence', () => {
    expect(result.features.length).toBeGreaterThan(20)
    for (const f of result.features) {
      expect(f.id).toBeTruthy()
      expect(f.label).toBeTruthy()
      expect(Number.isFinite(f.value as number)).toBe(true)
      expect(f.unit).toBeTruthy()
      expect(['measured', 'inferred']).toContain(f.status)
      expect(f.confidence).toBeGreaterThan(0)
      expect(f.confidence).toBeLessThanOrEqual(1)
      expect(f.evidence.length).toBeGreaterThan(4)
    }
  })

  it('深度类一律标 inferred —— 它们是从弱透视 z 推出来的，不是实测', () => {
    const depthIds = ['face3d.nose.rootDepth', 'face3d.wuYue.zhong', 'face3d.mingGong.fullness']
    for (const id of depthIds) {
      expect(result.features.find((f) => f.id === id)?.status).toBe('inferred')
    }
  })

  it('没有 NaN', () => {
    for (const f of result.features) expect(Number.isNaN(f.value as number)).toBe(false)
  })
})

describe('十二宫统计', () => {
  const stats = allPalaceStats(BASE)

  it('确实是十二宫，且补上了原表缺的夫妻宫', () => {
    expect(stats).toHaveLength(12)
    expect(stats.map((s) => s.palace)).toContain('夫妻宫')
  })

  it('每宫都有正的面积', () => {
    for (const s of stats) expect(s.area, s.palace).toBeGreaterThan(0)
  })

  it('成对宫位给出左右一致度，单侧宫位为 null', () => {
    const paired = stats.find((s) => s.palace === '兄弟宫')!
    expect(paired.symmetry).not.toBeNull()
    expect(paired.symmetry!).toBeGreaterThan(0.5)

    expect(stats.find((s) => s.palace === '命宫')!.symmetry).toBeNull()
  })

  it('规范脸左右严格对称，成对宫位的一致度应当很高', () => {
    for (const s of stats) {
      if (s.symmetry !== null) expect(s.symmetry, s.palace).toBeGreaterThan(0.85)
    }
  })
})

describe('三维对称', () => {
  it('规范脸接近满分', () => {
    const v = valuesOf(LM).get('face3d.symmetry.score')!
    expect(v).toBeGreaterThan(0.9)
  })

  it('把一侧颧骨往前推，分数下降且深度偏侧被测出来', () => {
    const skewed = LM.map((p, i) =>
      i === ZYGOMATIC.left || i === 425 || i === 280 ? { ...p, z: p.z - 0.03 } : p,
    )
    const before = valuesOf(LM)
    const after = valuesOf(skewed)
    expect(after.get('face3d.symmetry.score')!).toBeLessThan(before.get('face3d.symmetry.score')!)
    expect(Math.abs(after.get('face3d.symmetry.depthBias')!)).toBeGreaterThan(
      Math.abs(before.get('face3d.symmetry.depthBias')!),
    )
  })
})

describe('骨肉代理', () => {
  it('指数落在 0–1，且与颌线转折同向', () => {
    const v = valuesOf(LM)
    const idx = v.get('face3d.boneFlesh.index')!
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(idx).toBeLessThanOrEqual(1)
    expect(v.get('face3d.boneFlesh.jawAngularity')!).toBeGreaterThanOrEqual(0)
  })
})

describe('眼宽辅助量', () => {
  it('单眼宽是 IOD 的合理比例', () => {
    const w = eyeWidth(BASE)
    expect(w).toBeGreaterThan(0.15)
    expect(w).toBeLessThan(0.5)
  })
})

describe('镜像点对的三维残差', () => {
  it('规范脸的残差极小', () => {
    const P = BASE.points
    expect(dist3d(P[263], { ...P[33], x: -P[33].x })).toBeLessThan(0.05)
  })
})
