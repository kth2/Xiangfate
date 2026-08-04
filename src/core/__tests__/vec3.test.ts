/**
 * 三维基本运算。这些是 3D 特征管线的地基 ——
 * 平面拟合或主轴解错方向，上面所有的「隆起」「朝拱」「对称」就全是错的，
 * 而且错得看不出来（数值仍然合理，只是含义反了）。
 */

import { describe, expect, it } from 'vitest'
import {
  centroid3,
  cross3,
  distToPlane,
  dot3,
  fitPlane,
  len3,
  norm3,
  orthogonalize,
  polygonArea3,
  principalAxes3,
  reflectAcrossPlane,
  sub3,
  v3,
} from '../vec3'

describe('基本运算', () => {
  it('叉乘满足右手定则', () => {
    const c = cross3(v3(1, 0, 0), v3(0, 1, 0))
    expect(c.x).toBeCloseTo(0)
    expect(c.y).toBeCloseTo(0)
    expect(c.z).toBeCloseTo(1)
  })

  it('归一化零向量不产生 NaN', () => {
    const n = norm3(v3(0, 0, 0))
    expect(Number.isNaN(n.x)).toBe(false)
    expect(len3(n)).toBe(0)
  })

  it('正交化之后与基向量点积为 0', () => {
    const b = norm3(v3(1, 1, 0))
    const a = orthogonalize(v3(2, 0, 1), b)
    expect(dot3(a, b)).toBeCloseTo(0, 10)
  })
})

describe('平面拟合', () => {
  it('共面点拟合出的法向与真实法向平行', () => {
    // z = 0 平面上的一圈点
    const pts = [v3(1, 0, 0), v3(0, 1, 0), v3(-1, 0, 0), v3(0, -1, 0), v3(0.5, 0.5, 0)]
    const plane = fitPlane(pts)
    expect(Math.abs(plane.normal.z)).toBeCloseTo(1, 6)
    for (const p of pts) expect(Math.abs(distToPlane(p, plane))).toBeLessThan(1e-6)
  })

  it('倾斜平面同样拟合得出', () => {
    // z = x 的平面，真实法向 ∝ (1, 0, -1)
    const pts = [v3(0, 0, 0), v3(1, 0, 1), v3(0, 1, 0), v3(1, 1, 1), v3(2, 0.5, 2)]
    const plane = fitPlane(pts)
    const truth = norm3(v3(1, 0, -1))
    expect(Math.abs(dot3(plane.normal, truth))).toBeCloseTo(1, 5)
  })

  it('点数不足时不抛错', () => {
    expect(() => fitPlane([v3(0, 0, 0), v3(1, 1, 1)])).not.toThrow()
  })

  it('有符号距离两侧异号', () => {
    const plane = { normal: v3(0, 0, 1), point: v3(0, 0, 0) }
    expect(distToPlane(v3(0, 0, 2), plane)).toBeGreaterThan(0)
    expect(distToPlane(v3(0, 0, -2), plane)).toBeLessThan(0)
  })
})

describe('镜像', () => {
  it('关于 x=0 平面翻转只改 x 的符号', () => {
    const plane = { normal: v3(1, 0, 0), point: v3(0, 0, 0) }
    const m = reflectAcrossPlane(v3(3, 2, 1), plane)
    expect(m.x).toBeCloseTo(-3)
    expect(m.y).toBeCloseTo(2)
    expect(m.z).toBeCloseTo(1)
  })

  it('翻两次回到原处', () => {
    const plane = { normal: norm3(v3(1, 1, 0)), point: v3(0.5, 0, 0) }
    const p = v3(2, -1, 3)
    const back = reflectAcrossPlane(reflectAcrossPlane(p, plane), plane)
    expect(back.x).toBeCloseTo(p.x, 10)
    expect(back.y).toBeCloseTo(p.y, 10)
    expect(back.z).toBeCloseTo(p.z, 10)
  })

  it('平面上的点翻转后不动', () => {
    const plane = { normal: v3(0, 1, 0), point: v3(0, 5, 0) }
    const m = reflectAcrossPlane(v3(2, 5, 3), plane)
    expect(m.y).toBeCloseTo(5)
  })
})

describe('主轴', () => {
  it('拉长方向被识别为第一主轴', () => {
    const pts = Array.from({ length: 21 }, (_, i) => v3((i - 10) * 0.5, 0.01 * ((i % 3) - 1), 0))
    const { axes } = principalAxes3(pts)
    expect(Math.abs(axes[0].x)).toBeGreaterThan(0.99)
  })

  it('三轴两两正交且都是单位长', () => {
    const pts = [v3(1, 0, 0), v3(0, 2, 0), v3(0, 0, 3), v3(1, 1, 1), v3(-1, 2, 0.5)]
    const { axes } = principalAxes3(pts)
    for (const a of axes) expect(len3(a)).toBeCloseTo(1, 6)
    expect(dot3(axes[0], axes[1])).toBeCloseTo(0, 6)
    expect(dot3(axes[1], axes[2])).toBeCloseTo(0, 6)
    expect(dot3(axes[0], axes[2])).toBeCloseTo(0, 6)
  })
})

describe('多边形面积', () => {
  it('平面上的单位正方形面积为 1', () => {
    expect(polygonArea3([v3(0, 0, 0), v3(1, 0, 0), v3(1, 1, 0), v3(0, 1, 0)])).toBeCloseTo(1, 6)
  })

  it('把同一个正方形立起来，面积不变 —— 面积不该依赖它朝哪儿', () => {
    expect(polygonArea3([v3(0, 0, 0), v3(0, 1, 0), v3(0, 1, 1), v3(0, 0, 1)])).toBeCloseTo(1, 6)
  })

  it('退化输入返回 0', () => {
    expect(polygonArea3([v3(0, 0, 0), v3(1, 1, 1)])).toBe(0)
  })
})

describe('质心', () => {
  it('对称点集的质心在中心', () => {
    const c = centroid3([v3(-1, 0, 0), v3(1, 0, 0), v3(0, 2, 0), v3(0, -2, 0)])
    expect(len3(sub3(c, v3(0, 0, 0)))).toBeCloseTo(0, 10)
  })

  it('空集不产生 NaN', () => {
    expect(Number.isNaN(centroid3([]).x)).toBe(false)
  })
})
