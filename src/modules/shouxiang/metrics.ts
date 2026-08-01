/**
 * 手型 / 指形度量 —— 这部分来自 21 个关节点，可靠度高。
 * 掌纹在 palmlines.ts，掌丘在 mounts.ts。
 */

import { dist, type P2, type P3 } from '@/core/geom'
import { FINGERS, HAND, type FingerName } from './landmarks'

export interface HandMetrics {
  palmLen: number
  palmWidth: number
  /** 掌宽 ÷ 掌长，越大越方阔 */
  palmAspect: number
  fingerLen: Record<FingerName, number>
  /** 中指长 ÷ 掌长 */
  fingerPalmRatio: number
  /** 拇指长 ÷ 掌长 */
  thumbRatio: number
  /** 食指长 ÷ 无名指长（传统手相的木星丘/太阳丘倾向代理） */
  indexRingRatio: number
  /** 小指尖是否超过无名指 DIP —— 传统「小指长短」判据 */
  pinkyLong: boolean
  /** 指节突出度 0–1（由指节处的宽度变化估计） */
  knuckleProminence: number
}

export function computeHandMetrics(landmarks: P3[], imgW: number, imgH: number): HandMetrics {
  const aspect = imgW / imgH
  const Q = (i: number): P2 => ({ x: landmarks[i].x * aspect, y: landmarks[i].y })

  const palmLen = dist(Q(HAND.wrist), Q(HAND.middleMcp))
  const palmWidth = dist(Q(HAND.indexMcp), Q(HAND.pinkyMcp))

  // 分段求和比 MCP→TIP 直线距离更抗手指弯曲
  const segLen = (idx: readonly number[]) => {
    let L = 0
    for (let i = 1; i < idx.length; i++) L += dist(Q(idx[i - 1]), Q(idx[i]))
    return L
  }

  const fingerLen = {
    thumb: segLen(FINGERS.thumb),
    index: segLen(FINGERS.index),
    middle: segLen(FINGERS.middle),
    ring: segLen(FINGERS.ring),
    pinky: segLen(FINGERS.pinky),
  } as Record<FingerName, number>

  // 小指尖 y 是否高于（小于）无名指 DIP 的 y
  const pinkyLong = Q(HAND.pinkyTip).y < Q(HAND.ringDip).y

  // 指节突出：PIP/DIP 处相邻段的方向变化幅度
  const jointAngles: number[] = []
  for (const idx of [FINGERS.index, FINGERS.middle, FINGERS.ring]) {
    for (let i = 1; i < idx.length - 1; i++) {
      const a = Q(idx[i - 1])
      const b = Q(idx[i])
      const c = Q(idx[i + 1])
      const v1 = { x: a.x - b.x, y: a.y - b.y }
      const v2 = { x: c.x - b.x, y: c.y - b.y }
      const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)
      if (m < 1e-9) continue
      const ang = Math.acos(Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / m)))
      jointAngles.push(Math.PI - ang)
    }
  }
  const knuckle =
    jointAngles.length > 0
      ? Math.min(1, jointAngles.reduce((a, b) => a + b, 0) / jointAngles.length / 0.5)
      : 0.4

  return {
    palmLen,
    palmWidth,
    palmAspect: palmLen > 1e-9 ? palmWidth / palmLen : 0,
    fingerLen,
    fingerPalmRatio: palmLen > 1e-9 ? fingerLen.middle / palmLen : 0,
    thumbRatio: palmLen > 1e-9 ? fingerLen.thumb / palmLen : 0,
    indexRingRatio: fingerLen.ring > 1e-9 ? fingerLen.index / fingerLen.ring : 0,
    pinkyLong,
    knuckleProminence: +knuckle.toFixed(2),
  }
}
