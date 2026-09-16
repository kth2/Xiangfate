/**
 * 单应变换（透视校正）。
 *
 * 掌纹分析的第一步：用 21 个关节点把手掌摊平投影到标准掌画布。
 * 归一化之后，掌纹的位置先验才有稳定意义 —— 否则手掌稍微倾斜，
 * 生命线就跑到智慧线的位置去了。
 */

import type { P2 } from '@/core/geom'

export type Matrix3 = [number, number, number, number, number, number, number, number, number]

/**
 * 由四组对应点求单应矩阵（DLT + 高斯消元）。
 * 返回把 src 映射到 dst 的 3×3 矩阵（行主序）。
 */
export function findHomography(src: P2[], dst: P2[]): Matrix3 {
  if (src.length < 4 || dst.length < 4) throw new Error('单应变换至少需要 4 组对应点')

  // 8 个未知数（h33 固定为 1），构造 8×9 线性方程组
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }

  const h = solve8(A)
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

/** 8×9 增广矩阵的高斯消元（带部分主元） */
function solve8(A: number[][]): number[] {
  const n = 8
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    }
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error('单应矩阵求解失败：对应点退化')
    ;[A[col], A[pivot]] = [A[pivot], A[col]]

    const p = A[col][col]
    for (let c = col; c <= n; c++) A[col][c] /= p

    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c]
    }
  }
  return A.map((row) => row[n])
}

export function applyHomography(H: Matrix3, p: P2): P2 {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 }
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  }
}

export function invertHomography(H: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = H
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('单应矩阵不可逆')
  const inv = [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ]
  return inv as Matrix3
}

/**
 * 用逆映射 + 双线性插值把源图重采样到目标画布。
 * 逆映射保证目标画布每个像素都有值，不会出现空洞。
 */
export function warpPerspective(
  src: ImageData,
  H: Matrix3,
  outW: number,
  outH: number,
): ImageData {
  const Hinv = invertHomography(H)
  const out = new ImageData(outW, outH)
  const { width: sw, height: sh, data: sd } = src
  const od = out.data

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyHomography(Hinv, { x, y })
      const sx = p.x
      const sy = p.y
      const oi = (y * outW + x) * 4

      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        od[oi + 3] = 0
        continue
      }
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0

      for (let ch = 0; ch < 3; ch++) {
        const i00 = (y0 * sw + x0) * 4 + ch
        const i10 = (y0 * sw + x0 + 1) * 4 + ch
        const i01 = ((y0 + 1) * sw + x0) * 4 + ch
        const i11 = ((y0 + 1) * sw + x0 + 1) * 4 + ch
        od[oi + ch] =
          sd[i00] * (1 - fx) * (1 - fy) +
          sd[i10] * fx * (1 - fy) +
          sd[i01] * (1 - fx) * fy +
          sd[i11] * fx * fy
      }
      od[oi + 3] = 255
    }
  }
  return out
}

/**
 * 最小二乘仿射（6 自由度），结果仍写成 Matrix3，末行固定 [0,0,1]。
 *
 * ── 为什么手掌归一化要用它，而不是单应 ──────────────────
 * 单应要求四组对应点处于「一般位置」：任意三点不得近共线。
 * 掌部可用的稳定锚点里，食指/中指/小指 MCP **全在指根一线上** ——
 * 实测真手上这个三角形高只有底的 0.109 倍，等于近共线。
 * 于是投影分母 w 在 21 点之间从 0.27 摆到 2.71，拇指根被甩到 x = −1.7 个画布宽，
 * 而金星丘、生命线的位置先验全都写在那一块。更要命的是它不稳：
 * 中指 MCP 抖 2px，画布上的点最多跑 150px（画布才 512px 宽）——
 * 同一个人拍两次，两套读数就是这么来的。
 *
 * 仿射没有投影分母，折不过去；且只要三点不共线就良态，
 * 而腕点离指根线很远，这一条天然满足。同一组实测数据上：
 * 掌内 7 点 0 个出界（单应 2 个），抖 2px 最大位移 0.9px（单应 150px）。
 *
 * 代价是放弃真正的透视矫正。但采集本来就要求掌面法向与视轴夹角 ≤ 20°，
 * 在这个范围内仿射足够近似 —— 何况现在这个单应并没有在矫正透视，
 * 它在破坏坐标系。
 *
 * 超定（4 组对应 = 8 方程，6 未知）用正规方程解，
 * 不强求穿过每一个锚点 —— 迁就一个有噪声的第四点正是病态的来源。
 */
export function fitAffine(src: P2[], dst: P2[]): Matrix3 {
  if (src.length !== dst.length || src.length < 3) {
    throw new Error('fitAffine: 至少三组对应点')
  }

  // x 与 y 两组共用同一个 3×3 正规方程矩阵，只有右端不同
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const bx = [0, 0, 0]
  const by = [0, 0, 0]

  for (let k = 0; k < src.length; k++) {
    const row = [src[k].x, src[k].y, 1]
    for (let i = 0; i < 3; i++) {
      bx[i] += row[i] * dst[k].x
      by[i] += row[i] * dst[k].y
      for (let j = 0; j < 3; j++) M[i][j] += row[i] * row[j]
    }
  }

  const [a, b, c] = solve3(M, bx)
  const [d, e, f] = solve3(M, by)
  return [a, b, c, d, e, f, 0, 0, 1]
}

/** 高斯消元解 3×3。M 会被就地改写，所以每次调用都复制一份 */
function solve3(src: number[][], rhs: number[]): [number, number, number] {
  const M = src.map((r) => [...r])
  const v = [...rhs]

  for (let i = 0; i < 3; i++) {
    let piv = i
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r
    if (Math.abs(M[piv][i]) < 1e-12) throw new Error('fitAffine: 对应点退化（共线）')
    ;[M[i], M[piv]] = [M[piv], M[i]]
    ;[v[i], v[piv]] = [v[piv], v[i]]
    for (let r = 0; r < 3; r++) {
      if (r === i) continue
      const factor = M[r][i] / M[i][i]
      for (let col = 0; col < 3; col++) M[r][col] -= factor * M[i][col]
      v[r] -= factor * v[i]
    }
  }
  return [v[0] / M[0][0], v[1] / M[1][1], v[2] / M[2][2]]
}
