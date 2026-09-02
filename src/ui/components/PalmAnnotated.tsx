import { useEffect, useRef } from 'react'
import type { P2 } from '@/core/geom'
import type { PalmOverlay } from '@/store/analysis.store'

/**
 * 报告页的掌图标注：把这次实际采信的掌线描在标准掌图上，逐条落一个序号，
 * 序号与下方列表一一对应。
 *
 * 与 PalmLineCorrector 的分工：那个是**采集期**的交互（点线、指认、可改），
 * 这个是**报告期**的呈现（只读、带号、不可改）。两者都从 analysis.normalized 起画，
 * 但职责不同，合成一个组件只会让两边的状态互相绊住。
 *
 * ⚠️ 徽标一律画在它所指的那条线上（落点由 overlay.ts 挑好），因此不需要引线。
 * 手机上引线又细又密，比直接把号压在线上更难看清。
 */
export function PalmAnnotated({ overlay, accent }: { overlay: PalmOverlay; accent: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { image, marks } = overlay
    canvas.width = image.width
    canvas.height = image.height
    ctx.putImageData(image, 0, 0)

    // 先描线，再落号 —— 号要压在线上面
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const m of marks) {
      if (!m.path || m.path.length < 2) continue
      // 深色描边垫底，浅色掌图上金线才看得清
      strokePath(ctx, m.path, 'rgba(0,0,0,0.35)', 6)
      strokePath(ctx, m.path, 'rgba(200,169,106,0.95)', 3)
    }

    const R = Math.max(14, image.width * 0.035)
    for (const m of marks) {
      if (!m.anchor) continue
      drawBadge(ctx, m.anchor, R, String(m.n), m.kind === 'mount')
    }
  }, [overlay, accent])

  return (
    <canvas
      ref={ref}
      className="block w-full"
      style={{ aspectRatio: `${overlay.image.width} / ${overlay.image.height}` }}
      role="img"
      aria-label={`掌图标注，共 ${overlay.marks.filter((m) => m.anchor).length} 处`}
    />
  )
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  p: P2,
  r: number,
  text: string,
  hollow: boolean,
): void {
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  // 掌丘用空心圈区别于掌线的实心号 —— 一个是面，一个是线
  ctx.fillStyle = hollow ? 'rgba(28,26,24,0.78)' : 'rgba(196,64,58,0.95)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(200,169,106,0.95)'
  ctx.stroke()

  ctx.fillStyle = '#f5efe3'
  ctx.font = `600 ${Math.round(r * 1.15)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // 字形基线在各平台略有出入，往下压一点点看起来才居中
  ctx.fillText(text, p.x, p.y + r * 0.06)
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: P2[],
  color: string,
  width: number,
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}
