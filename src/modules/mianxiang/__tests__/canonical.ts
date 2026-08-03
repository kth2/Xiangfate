/**
 * 测试用的合成正脸 —— 由 MediaPipe 官方规范人脸网格投影而来。
 *
 * 不是 *.test.ts，vitest 不会当测试收集；供 pipeline / marks 两组测试共用。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import type { P3 } from '@/core/geom'
import { EYE, IRIS } from '../landmarks'

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../tests/fixtures/canonical-face-model.json', import.meta.url)),
    'utf8',
  ),
) as { vertices: [number, number, number][] }

export const IMG_W = 1080
export const IMG_H = 1440

/**
 * 规范模型（y 向上、单位约 cm）→ 归一化图像坐标（y 向下、0–1）。
 * 等比缩放后居中，模拟一张正对镜头、无透视畸变的照片。
 */
export function projectCanonical(): P3[] {
  const V = fixture.vertices
  const xs = V.map((v) => v[0])
  const ys = V.map((v) => v[1])
  const spanY = Math.max(...ys) - Math.min(...ys)

  // 让脸高占画面 70%
  const scalePx = (IMG_H * 0.7) / spanY
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2

  const pts: P3[] = V.map(([x, y, z]) => ({
    x: 0.5 + ((x - cx) * scalePx) / IMG_W,
    // y 翻转：模型向上为正，图像向下为正
    y: 0.5 - ((y - cy) * scalePx) / IMG_H,
    // z 与 x 同尺度，且 MediaPipe 约定越靠近镜头越小 → 取负
    z: (-z * scalePx) / IMG_W,
  }))

  // 规范模型只有 468 点；虹膜 468–477 由 attention 模型另出，这里合成
  const synthIris = (side: 'left' | 'right') => {
    const E = EYE[side]
    const cxE = (pts[E.inner].x + pts[E.outer].x) / 2
    const cyE = (pts[E.upper].y + pts[E.lower].y) / 2
    const zE = (pts[E.inner].z + pts[E.outer].z) / 2
    // 虹膜半径约为眼宽的 22%
    const r = Math.hypot(pts[E.outer].x - pts[E.inner].x, pts[E.outer].y - pts[E.inner].y) * 0.22
    return {
      center: { x: cxE, y: cyE, z: zE },
      ring: [
        { x: cxE, y: cyE - r * (IMG_W / IMG_H), z: zE },
        { x: cxE + r, y: cyE, z: zE },
        { x: cxE, y: cyE + r * (IMG_W / IMG_H), z: zE },
        { x: cxE - r, y: cyE, z: zE },
      ],
    }
  }

  const out = [...pts]
  const R = synthIris('right')
  const L = synthIris('left')
  out[IRIS.right.center] = R.center
  IRIS.right.ring.forEach((i, k) => (out[i] = R.ring[k]))
  out[IRIS.left.center] = L.center
  IRIS.left.ring.forEach((i, k) => (out[i] = L.ring[k]))
  return out
}

/** ImageData 是浏览器 API，Node 里没有；算子只用 data/width/height 三个字段 */
export function makeImageData(w: number, h: number): ImageData {
  return {
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h,
    colorSpace: 'srgb',
  } as ImageData
}

/** 固定种子的伪随机数（mulberry32）—— 噪声要有，但必须可复现 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
