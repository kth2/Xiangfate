import { useEffect, useMemo, useRef, useState } from 'react'
import type { P2 } from '@/core/geom'
import type { PalmLineName } from '@/core/types'
import { canvasToView, type HandView, type SourceFrame } from '@/modules/shouxiang/overlay'
import { rankCandidates } from '@/modules/shouxiang/palmlines'
import type { PalmAnalysis } from '@/modules/shouxiang/pipeline'

const PICKABLE: PalmLineName[] = ['生命线', '智慧线', '感情线', '命运线']

/**
 * 一次最多让用户在几条候选里挑。
 *
 * 原先把**全部**候选都画出来 —— 实测一张手掌照上几十条，绝大多数是碎纹，
 * 「请指出生命线」在那种图上是答不出来的。十二条足够放下主线，
 * 又还能在手机上一眼扫完。纯排版取舍，不影响任何度量。
 */
const SHOW_CANDIDATES = 12

/**
 * 掌纹手动校正。
 *
 * 这是手相模块的产品安全网：自动识别不到主线时，宁可请用户参与，
 * 也绝不凭空生成掌纹判断。跳过也完全可以 —— 那条线会如实标为「未测到」。
 *
 * ⚠️ 坐标有两套，别弄混：
 *   · **标准画布坐标** —— 度量层唯一认的帧，onDone 交出去的必须是它。
 *   · **展示画面坐标** —— 扶正取景后的原照片，画布上画的、用户点的都是它。
 * 这里画与点都在展示坐标里做，记录时仍用画布坐标 —— 因为归一化那个帧
 * 目前是坏的（任何手形下都有关节点被甩出画布），拿它给人看根本认不出自己的手。
 */
export function PalmLineCorrector({
  analysis,
  image,
  view,
  frame,
  missing,
  accent,
  onDone,
}: {
  analysis: PalmAnalysis
  /** 扶正取景后的原照片 */
  image: ImageData
  /** 原照片 → 展示画面 */
  view: HandView
  /** 标准画布 → 原照片 */
  frame: SourceFrame
  missing: PalmLineName[]
  accent: string
  onDone: (corrections: Partial<Record<PalmLineName, P2[]>>) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [assigned, setAssigned] = useState<Partial<Record<PalmLineName, number>>>({})
  const [target, setTarget] = useState<PalmLineName>(missing[0] ?? PICKABLE[0])

  const W = image.width
  const H = image.height

  /** 候选只留最显著的若干条，且预先换算到展示坐标 —— 画与点都用这一份 */
  const shown = useMemo(() => {
    const toView = canvasToView(frame, view)
    return rankCandidates(analysis.candidates, analysis.response, SHOW_CANDIDATES).map((c) => ({
      /** 交回上层时要用的标准画布坐标 */
      points: c.points,
      /** 界面上用的展示坐标 */
      viewPoints: c.points.map(toView),
    }))
  }, [analysis, frame, view])

  const acceptedInView = useMemo(() => {
    const toView = canvasToView(frame, view)
    return [...analysis.lines.values()].map((L) => L.points.map(toView))
  }, [analysis, frame, view])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = W
    canvas.height = H
    ctx.putImageData(image, 0, 0)

    const unit = Math.max(W, H) / 900
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // 已识别的主线：金色
    for (const pts of acceptedInView) strokePath(ctx, pts, 'rgba(200,169,106,0.9)', 3 * unit)

    // 候选：暗色，选中的高亮
    shown.forEach((c, i) => {
      const isAssigned = Object.values(assigned).includes(i)
      strokePath(
        ctx,
        c.viewPoints,
        i === selected ? '#c4403a' : isAssigned ? 'rgba(200,169,106,0.9)' : 'rgba(255,255,255,0.5)',
        (i === selected ? 4.5 : 2.5) * unit,
      )
    })
  }, [image, acceptedInView, shown, selected, assigned, W, H])

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H

    // 找离点击处最近的候选线
    let best = -1
    let bestD = Infinity
    shown.forEach((c, i) => {
      for (const p of c.viewPoints) {
        const d = Math.hypot(p.x - x, p.y - y)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
    })
    if (best >= 0 && bestD < W * 0.06) setSelected(best)
  }

  function assign() {
    if (selected === null) return
    setAssigned((a) => ({ ...a, [target]: selected }))
    setSelected(null)
    const next = missing.find((n) => n !== target && assigned[n] === undefined)
    if (next) setTarget(next)
  }

  function finish() {
    const out: Partial<Record<PalmLineName, P2[]>> = {}
    for (const [name, idx] of Object.entries(assigned)) {
      if (idx === undefined) continue
      // 交出去的是标准画布坐标 —— 度量层只认那个帧
      out[name as PalmLineName] = shown[idx].points
    }
    onDone(out)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-title mb-2 text-lg tracking-[0.1em]">帮我确认一下掌线</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          有 {missing.length} 条主线不太好自动辨认。下图里画出的是最像掌纹的
          {' '}{shown.length} 条候选，点一下其中一条，再选它是哪条主线。
          都不像就跳过 —— 我会如实标注为「未测到」，不会瞎猜。
        </p>
      </div>

      <div className="card overflow-hidden">
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          className="block w-full cursor-crosshair"
          style={{ aspectRatio: `${W} / ${H}` }}
        />
      </div>

      <div>
        <p className="mb-2 text-[12px] text-subtle">这条线是：</p>
        <div className="flex flex-wrap gap-2">
          {PICKABLE.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setTarget(n)}
              className="border px-3 py-2 text-[13px] transition-colors"
              style={{
                borderColor: n === target ? accent : 'var(--line)',
                color: assigned[n] !== undefined ? accent : n === target ? 'var(--fg-base)' : 'var(--fg-subtle)',
                borderRadius: 2,
              }}
            >
              {n}
              {assigned[n] !== undefined && ' ✓'}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={assign}
        disabled={selected === null}
        className="btn-outline h-11 w-full text-[14px] disabled:opacity-40"
      >
        {selected === null ? '先在图上点一条线' : `确认这条是${target}`}
      </button>

      <button type="button" onClick={finish} className="btn-seal h-12 w-full text-[15px]">
        {Object.keys(assigned).length ? '完成校正' : '跳过，直接出报告'}
      </button>

      <p className="text-center text-[11px] text-subtle">
        跳过不影响出报告，只是这几条线不会被解读
      </p>
    </div>
  )
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  pts: P2[],
  color: string,
  width = 3,
): void {
  if (pts.length < 2) return
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}
