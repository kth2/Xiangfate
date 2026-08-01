import { useEffect, useRef } from 'react'
import type { DetectorKind } from '@/core/registry'

export interface Pt {
  x: number
  y: number
}

/**
 * 关键点叠加层。把检测结果画在照片上给用户看 —— 这一步是建立信任的关键环节
 * （参考 bz51/AIFace 的「特征点识别」页）。
 *
 * 坐标是归一化的 0–1，按容器尺寸缩放绘制。
 */
export function LandmarkOverlay({
  points,
  detector,
  connections,
  color = 'var(--color-gold-400)',
  className = '',
}: {
  points: Pt[]
  detector: DetectorKind
  /** 连线索引对，缺省时只画点 */
  connections?: readonly (readonly [number, number])[]
  color?: string
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || points.length === 0) return

    const parent = canvas.parentElement
    if (!parent) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = parent.clientWidth
    const h = parent.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const resolved = getComputedStyle(canvas).getPropertyValue('--overlay-color').trim() || color

    // 面部 478 点太密，画小一点、淡一点；手/体只有 21/33 点，可以画大
    const dotR = detector === 'face' ? 0.7 : 2.2
    const alpha = detector === 'face' ? 0.5 : 0.9

    if (connections?.length) {
      ctx.strokeStyle = resolved
      ctx.globalAlpha = alpha * 0.7
      ctx.lineWidth = detector === 'face' ? 0.4 : 1.4
      ctx.beginPath()
      for (const [a, b] of connections) {
        const pa = points[a]
        const pb = points[b]
        if (!pa || !pb) continue
        ctx.moveTo(pa.x * w, pa.y * h)
        ctx.lineTo(pb.x * w, pb.y * h)
      }
      ctx.stroke()
    }

    ctx.fillStyle = resolved
    ctx.globalAlpha = alpha
    for (const p of points) {
      ctx.beginPath()
      ctx.arc(p.x * w, p.y * h, dotR, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }, [points, connections, color, detector])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ '--overlay-color': color } as React.CSSProperties}
    />
  )
}

/** MediaPipe Hands 的 21 点骨架连线 */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
] as const

/** MediaPipe Pose 的主要骨架连线（躯干 + 四肢，省略面部细节点） */
export const POSE_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [23, 25], [25, 27], [27, 31],
  [24, 26], [26, 28], [28, 32],
  [0, 11], [0, 12],
] as const
