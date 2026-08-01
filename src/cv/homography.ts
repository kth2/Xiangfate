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
