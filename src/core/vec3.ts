/**
 * 三维向量与平面拟合。
 *
 * geom.ts 是二维的 —— 它服务的是「把关键点投影到画面上量长度」那套算法。
 * 面相要往 3D 走（隆起、朝拱、中矢面对称），需要的是另一组基本运算，
 * 单独放这里，保持 geom.ts 不被撑大。
 *
 * ⚠️ 本文件属于 src/core，只放纯函数。
 */

export interface V3 {
  x: number
  y: number
  z: number
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z })

export const add3 = (a: V3, b: V3): V3 => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub3 = (a: V3, b: V3): V3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale3 = (a: V3, k: number): V3 => v3(a.x * k, a.y * k, a.z * k)
export const dot3 = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross3 = (a: V3, b: V3): V3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
export const len3 = (a: V3): number => Math.hypot(a.x, a.y, a.z)
export const dist3d = (a: V3, b: V3): number => len3(sub3(a, b))

export function norm3(a: V3): V3 {
  const l = len3(a)
  return l > 1e-12 ? scale3(a, 1 / l) : v3(0, 0, 0)
}

export function centroid3(pts: V3[]): V3 {
  if (!pts.length) return v3(0, 0, 0)
  let x = 0
  let y = 0
  let z = 0
  for (const p of pts) {
    x += p.x
    y += p.y
    z += p.z
  }
  return v3(x / pts.length, y / pts.length, z / pts.length)
}

/** 把 a 中平行于 b 的分量减掉（b 需已归一化） */
export function orthogonalize(a: V3, b: V3): V3 {
  return sub3(a, scale3(b, dot3(a, b)))
}

export interface Plane {
  /** 单位法向 */
  normal: V3
  /** 平面上一点 */
  point: V3
}

/** 有符号距离：沿 normal 方向为正 */
export function distToPlane(p: V3, plane: Plane): number {
  return dot3(sub3(p, plane.point), plane.normal)
}

/** 关于平面镜像 */
export function reflectAcrossPlane(p: V3, plane: Plane): V3 {
  return sub3(p, scale3(plane.normal, 2 * distToPlane(p, plane)))
}

type Mat3 = [number, number, number, number, number, number, number, number, number]

/** 协方差矩阵（行主序 3×3） */
function covariance(pts: V3[], c: V3): Mat3 {
  const m: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (const p of pts) {
    const d = sub3(p, c)
    const a = [d.x, d.y, d.z]
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m[i * 3 + j] += a[i] * a[j]
  }
  const n = Math.max(1, pts.length)
  return m.map((v) => v / n) as Mat3
}

const mulMatVec = (m: Mat3, p: V3): V3 =>
  v3(
    m[0] * p.x + m[1] * p.y + m[2] * p.z,
    m[3] * p.x + m[4] * p.y + m[5] * p.z,
    m[6] * p.x + m[7] * p.y + m[8] * p.z,
  )

/** 瑞利商，用来比较哪个候选方向「更主」 */
const rayleigh = (m: Mat3, v: V3): number => dot3(v, mulMatVec(m, v))

/**
 * 幂迭代求主方向。
 * 不引数值库：这里只需要 3×3 对称阵的特征向量，幂迭代 + 收缩足够，
 * 而且没有外部依赖 —— 这是个装到手机上的 PWA，能省一个包是一个。
 *
 * ⚠️ 必须多个种子各试一遍：种子若正好落在零空间里，
 * 第一次相乘就得到零向量，函数会把**最小**特征向量当成主方向返回 ——
 * 症状是竖着的多边形算出面积 0（vec3.test.ts 里有这条用例）。
 */
function powerIteration(m: Mat3, iters = 48): V3 {
  const seeds = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), norm3(v3(0.6, 0.5, 0.62))]
  let best = seeds[0]
  let bestVal = -Infinity

  for (const seed of seeds) {
    let v = norm3(seed)
    if (len3(v) < 1e-9) continue
    let ok = true
    for (let i = 0; i < iters; i++) {
      const next = mulMatVec(m, v)
      const l = len3(next)
      if (l < 1e-12) {
        // 这个种子撞进了零空间，换下一个
        ok = false
        break
      }
      v = scale3(next, 1 / l)
    }
    if (!ok) continue
    const val = rayleigh(m, v)
    if (val > bestVal) {
      bestVal = val
      best = v
    }
  }
  return best
}

/** 从矩阵中减去某个特征方向的分量，好求下一个 */
function deflate(m: Mat3, v: V3): Mat3 {
  const lambda = dot3(v, mulMatVec(m, v))
  const a = [v.x, v.y, v.z]
  const out = [...m] as Mat3
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] -= lambda * a[i] * a[j]
  return out
}

/** 主轴分解：返回三个正交单位轴，按特征值从大到小 */
export function principalAxes3(pts: V3[]): { center: V3; axes: [V3, V3, V3] } {
  const center = centroid3(pts)
  const cov = covariance(pts, center)

  const a1 = powerIteration(cov)
  const a2raw = powerIteration(deflate(cov, a1))
  const a2 = norm3(orthogonalize(a2raw, a1))
  const a3 = norm3(cross3(a1, a2))

  return { center, axes: [a1, a2, a3] }
}

/**
 * 最小二乘拟合平面：法向 = 最小特征值方向，也就是主轴分解的第三轴。
 * 用于「面平面」（外周轮廓点拟合）与中矢面。
 */
export function fitPlane(pts: V3[]): Plane {
  if (pts.length < 3) return { normal: v3(0, 0, 1), point: centroid3(pts) }
  const { center, axes } = principalAxes3(pts)
  return { normal: axes[2], point: center }
}

/** 多边形面积（先投影到平面的两个主轴上，再用鞋带公式） */
export function polygonArea3(pts: V3[]): number {
  if (pts.length < 3) return 0
  const { center, axes } = principalAxes3(pts)
  const [u, v] = axes
  const flat = pts.map((p) => {
    const d = sub3(p, center)
    return { x: dot3(d, u), y: dot3(d, v) }
  })
  let s = 0
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i]
    const b = flat[(i + 1) % flat.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}
