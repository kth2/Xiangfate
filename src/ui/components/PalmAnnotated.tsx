import { useEffect, useRef } from 'react'
import type { P2 } from '@/core/geom'
import { labelText, placeLabels, type PalmLabel } from '@/modules/shouxiang/overlay'
import { colorOf } from '@/modules/shouxiang/palette'
import type { PalmOverlay } from '@/store/analysis.store'

/**
 * 报告页的掌图标注：把这次实际采信的掌线描在**原照片**上，
 * 一条线一个颜色，名目直接写在图上。
 *
 * 为什么画在原照片而不是标准掌图上：标准掌图是那个坏掉的单应变换的产物，
 * 任何手形下都有关节点被甩出画布，展示出来就是一张歪斜、带背景楔形、
 * 手掌没框住的图。描线用 H⁻¹ 映回原照片（逆变换是严格的，见 overlay.ts），
 * 再由 handViewTransform 裁到手上、把手扶正 —— 那一步是相似变换，
 * 只有旋转与等比缩放，21 个关键点保证全在画面内，不会重演折叠那一幕。
 *
 * 与 PalmLineCorrector 的分工：那个是**采集期**的交互（点线、指认、可改，
 * 画在标准掌图上，因为位置先验就定在那个帧里），
 * 这个是**报告期**的呈现（只读、带名带号、画在原照片上）。
 * 职责不同，合成一个组件只会让两边的状态互相绊住。
 *
 * ⚠️ 名牌一律紧贴它所指的那条线（落点由 overlay.ts 挑好），因此不需要引线。
 * 手机上引线又细又密，比直接把牌压在线边更难看清。
 */
export function PalmAnnotated({
  overlay,
  canvasRef,
}: {
  overlay: PalmOverlay
  /** 给外部用来导出图片；组件自己不提供下载按钮 */
  canvasRef?: React.Ref<HTMLCanvasElement>
}) {
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

    // 线宽与字号都跟画面尺寸走 —— 现在画的是原照片，尺寸因机而异
    const unit = Math.max(image.width, image.height) / 900
    const fontSize = Math.round(Math.max(13, 19 * unit))
    const font = `600 ${fontSize}px system-ui, sans-serif`

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const m of marks) {
      if (!m.path || m.path.length < 2) continue
      // 深色描边垫底：掌面是浅色，没有这一道底，浅色线会糊进皮肤
      strokePath(ctx, m.path, 'rgba(0,0,0,0.42)', 7.5 * unit)
      strokePath(ctx, m.path, colorOf(m.name, m.kind), 3.8 * unit)
    }

    ctx.font = font
    const labels = placeLabels(marks, { width: image.width, height: image.height }, {
      measure: (t) => ctx.measureText(t).width,
      fontSize,
      padX: Math.round(7 * unit),
      padY: Math.round(4.5 * unit),
      gap: Math.round(9 * unit),
    })

    // 先把锚点全部点出来，名牌再压上去 —— 牌子挤开之后，点还在线上指着
    for (const l of labels) dot(ctx, l.anchor, Math.max(3, 4.5 * unit), colorOf(l.mark.name, l.mark.kind))
    for (const l of labels) plate(ctx, l, font, unit)
  }, [overlay])

  return (
    <canvas
      ref={mergeRefs(ref, canvasRef)}
      className="block w-full"
      style={{ aspectRatio: `${overlay.image.width} / ${overlay.image.height}` }}
      role="img"
      aria-label={`掌图标注：${overlay.marks
        .filter((m) => m.anchor)
        .map((m) => m.name)
        .join('、')}`}
    />
  )
}

/** 名牌：线色实底 + 白字。掌面深浅不一，实底比描边字稳 */
function plate(ctx: CanvasRenderingContext2D, l: PalmLabel, font: string, unit: number): void {
  const color = colorOf(l.mark.name, l.mark.kind)
  const r = Math.min(l.height / 2, 6 * unit)

  ctx.beginPath()
  ctx.roundRect(l.x, l.y, l.width, l.height, r)
  ctx.fillStyle = color
  ctx.fill()
  // 浅色掌面上给牌子一圈暗边，边界才咬得住
  ctx.lineWidth = Math.max(1, 1.2 * unit)
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.stroke()

  ctx.font = font
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(labelText(l.mark), l.x + l.width / 2, l.y + l.height / 2 + l.height * 0.04)
}

function dot(ctx: CanvasRenderingContext2D, p: P2, r: number, color: string): void {
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = Math.max(1, r * 0.45)
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.stroke()
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

/** 组件自己要用 ref 画图，外部又要拿它导出图片，两边都得接上 */
function mergeRefs(
  own: React.RefObject<HTMLCanvasElement | null>,
  outer?: React.Ref<HTMLCanvasElement>,
): React.RefCallback<HTMLCanvasElement> {
  return (el) => {
    own.current = el
    if (typeof outer === 'function') outer(el)
    else if (outer) (outer as React.RefObject<HTMLCanvasElement | null>).current = el
  }
}
