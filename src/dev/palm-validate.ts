/**
 * 手相定标台（纯函数部分）。
 *
 * 造它是为了回答三个**目前只能靠猜**的问题。三个都源自同一次实测：
 * 一张手掌照的报告里，四条主线全部命中而沿线响应只有 0.14，
 * 月丘的标号落在背景地砖上，报告照样给了饱满度。
 *
 *   1. **归一化到底歪到什么程度？**
 *      normalizePalm 用单应变换，四组对应点里有三个（食指/中指/小指 MCP）
 *      挤在指根一线上。单应要求四点处于「一般位置」，三点近共线即病态：
 *      合成手上实测投影分母 w 从 2.13 一路掉到 0.40，掌根桡侧被甩到画布外
 *      (−0.955, 0.957)。但那是**我自己捏的一只手**。真实手上这个离散度是多少，
 *      不测不知道 —— 这里把每只手的 w 谱导出来。
 *
 *   2. **真实掌纹的响应落在哪？**
 *      SIGNAL_FLOOR 现在取 T.line.shallow 的一半，锚是有的，分位没有。
 *      只知道 0.14 那种碎纹得挡住，不知道真正淡而存在的纹在哪一档。
 *      导出每条线的 depth，样本够了就能按分位重设。
 *
 *   3. **掌丘的圆到底压在什么上？**
 *      亮度代理分不出皮肤和地砖。导出每个圆的取样统计与其相对掌面的位置，
 *      看哪些圆的行为像皮肤、哪些像背景。
 *      ⚠️ 但要真正**重定丘位**，光有这些还不够 —— 得有掌缘。
 *      掌缘需要分割或人工标注，这个导出给不了，别拿它凑合定标。
 *
 * ⚠️ 与 validate.ts 同一条红线：**这里不含任何图像**。
 * 导出的全是数字，照片始终留在浏览器里。
 */

import type { P2, P3 } from '@/core/geom'
import { applyHomography, findHomography, type Matrix3 } from '@/cv/homography'
import { CANVAS, CANVAS_ANCHORS, HAND, MOUNTS, MOUNT_RADIUS, type MountKey } from '@/modules/shouxiang/landmarks'
import type { LineMeasure } from '@/modules/shouxiang/palmlines'
import type { PalmLineName } from '@/core/types'

export const PALM_EXPORT_VERSION = 1

/** 一只手的一次采集。全是数字，没有像素 */
export interface PalmSample {
  /** 同一个人的多张照片共用，用来看跨拍摄一致性 */
  subjectId: string
  label: string
  side: 'left' | 'right'
  handedness: 'Left' | 'Right'
  landmarks: P3[]
  imgWidth: number
  imgHeight: number
  detectorScore: number
  /** 每条被归类出来的线的度量（不含 points —— 折线本身可反推掌形，不导出） */
  lines: Record<string, Omit<LineMeasure, 'points' | 'name'>>
  /** 每个掌丘取样圆内的统计 */
  mounts: Record<string, { sampleCount: number; medianLuma: number; fullness: number; band: string }>
  /** 掌面整体的亮度基准，供上面那行做对照 */
  palmMedianLuma: number
}

export interface PalmBundle {
  version: number
  exportedAt: string
  samples: PalmSample[]
}

/* ============================================================
   一、归一化的病态程度
   ============================================================ */

export interface WarpConditioning {
  /** 投影分母 w = h6·x + h7·y + 1 在 21 个关节点上的取值 */
  wMin: number
  wMax: number
  /** wMax / wMin。1 表示纯仿射，越大越发散 */
  wSpread: number
  /** 三个 MCP 偏离「食指—小指」弦的高度 ÷ 弦长。越小越接近共线，即越病态 */
  knuckleCollinearity: number
  /** 归一化后仍落在画布内的关节点数（共 21） */
  landmarksInCanvas: number
  /** 归一化后各关节点的画布比例坐标，用来看手实际落在哪 */
  warped: P2[]
}

export function warpConditioning(s: PalmSample): WarpConditioning {
  const mirrored = s.handedness === 'Left'
  const toPx = (i: number): P2 => ({
    x: (mirrored ? 1 - s.landmarks[i].x : s.landmarks[i].x) * s.imgWidth,
    y: s.landmarks[i].y * s.imgHeight,
  })

  const H: Matrix3 = findHomography(
    [toPx(HAND.indexMcp), toPx(HAND.pinkyMcp), toPx(HAND.wrist), toPx(HAND.middleMcp)],
    [
      CANVAS_ANCHORS.indexMcp,
      CANVAS_ANCHORS.pinkyMcp,
      CANVAS_ANCHORS.wrist,
      CANVAS_ANCHORS.middleMcp,
    ],
  )

  let wMin = Infinity
  let wMax = -Infinity
  const warped: P2[] = []
  let inCanvas = 0

  for (let i = 0; i < s.landmarks.length; i++) {
    const p = toPx(i)
    const w = H[6] * p.x + H[7] * p.y + 1
    wMin = Math.min(wMin, w)
    wMax = Math.max(wMax, w)

    const q = applyHomography(H, p)
    const r = { x: q.x / CANVAS.W, y: q.y / CANVAS.H }
    warped.push({ x: +r.x.toFixed(4), y: +r.y.toFixed(4) })
    if (r.x >= 0 && r.x <= 1 && r.y >= 0 && r.y <= 1) inCanvas++
  }

  const a = toPx(HAND.indexMcp)
  const b = toPx(HAND.pinkyMcp)
  const c = toPx(HAND.middleMcp)
  const chord = Math.hypot(b.x - a.x, b.y - a.y)
  const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))

  return {
    wMin: +wMin.toFixed(4),
    wMax: +wMax.toFixed(4),
    // w 可能异号；此时变换已经把手翻折了，比值没有意义，记为 Infinity
    wSpread: wMin > 0 ? +(wMax / wMin).toFixed(2) : Infinity,
    knuckleCollinearity: chord > 0 ? +(cross / chord / chord).toFixed(4) : 0,
    landmarksInCanvas: inCanvas,
    warped,
  }
}

/* ============================================================
   二、掌纹响应的分布 —— SIGNAL_FLOOR 该定在哪
   ============================================================ */

export interface DepthStats {
  n: number
  min: number
  p10: number
  p25: number
  median: number
  p75: number
  max: number
}

export function depthStats(samples: PalmSample[], line?: PalmLineName): DepthStats | null {
  const xs: number[] = []
  for (const s of samples) {
    for (const [name, m] of Object.entries(s.lines)) {
      if (line && name !== line) continue
      xs.push(m.depth)
    }
  }
  if (!xs.length) return null
  xs.sort((p, q) => p - q)
  const at = (f: number) => xs[Math.min(xs.length - 1, Math.floor(f * xs.length))]
  return {
    n: xs.length,
    min: xs[0],
    p10: at(0.1),
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    max: xs[xs.length - 1],
  }
}

/* ============================================================
   三、掌丘取样圆压在什么上
   ============================================================ */

export interface MountProbe {
  key: MountKey
  /** 圆心与外沿的画布 x，用来对照被锚定的指根线（食指 0.25、小指 0.75） */
  centerX: number
  outerX: number
  /** 圆内取到的像素数中位；太少说明圆有一大块在画布外 */
  medianSampleCount: number
  /** 圆内中位亮度 − 掌面中位亮度。始终同号且量大，多半量的不是皮肤 */
  medianLumaOffset: number
}

export function mountProbes(samples: PalmSample[]): MountProbe[] {
  const out: MountProbe[] = []
  for (const key of Object.keys(MOUNTS) as MountKey[]) {
    const counts: number[] = []
    const offsets: number[] = []
    for (const s of samples) {
      const m = s.mounts[key]
      if (!m) continue
      counts.push(m.sampleCount)
      offsets.push(m.medianLuma - s.palmMedianLuma)
    }
    if (!counts.length) continue
    out.push({
      key,
      centerX: MOUNTS[key].x,
      outerX: +(MOUNTS[key].x + MOUNT_RADIUS).toFixed(3),
      medianSampleCount: mid(counts),
      medianLumaOffset: +mid(offsets).toFixed(1),
    })
  }
  return out
}

function mid(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/* ============================================================
   报告
   ============================================================ */

export function formatPalmReport(bundle: PalmBundle): string {
  const S = bundle.samples
  const L: string[] = []
  L.push(`手相定标台 · ${S.length} 只手 / ${new Set(S.map((s) => s.subjectId)).size} 人`)
  L.push('')

  L.push('一、归一化的病态程度（w 谱越接近 1 越好；指根共线度越小越病态）')
  L.push('  样本                 wMin    wMax   wSpread  指根共线度  在画布内')
  for (const s of S) {
    const c = warpConditioning(s)
    L.push(
      `  ${s.label.padEnd(20).slice(0, 20)} ${fmt(c.wMin)} ${fmt(c.wMax)} ${fmt(c.wSpread)}   ${fmt(c.knuckleCollinearity)}      ${c.landmarksInCanvas}/21`,
    )
  }
  L.push('  ↑ wSpread 远大于 1，或有关节点落到画布外，即为单应变换在撕扯掌面。')
  L.push('    对照：仿射变换的 wSpread 恒为 1.00。')
  L.push('')

  L.push('二、掌纹响应分布（SIGNAL_FLOOR 现取 0.175，只是「浅」判线的一半，不是分位）')
  const all = depthStats(S)
  if (all) {
    L.push(
      `  全部线：n=${all.n}  min ${fmt(all.min)}  p10 ${fmt(all.p10)}  p25 ${fmt(all.p25)}  中位 ${fmt(all.median)}  p75 ${fmt(all.p75)}  max ${fmt(all.max)}`,
    )
    for (const name of ['生命线', '智慧线', '感情线', '命运线', '太阳线', '婚姻线'] as PalmLineName[]) {
      const d = depthStats(S, name)
      if (d) L.push(`  ${name}：n=${d.n}  p10 ${fmt(d.p10)}  中位 ${fmt(d.median)}  p75 ${fmt(d.p75)}`)
    }
    L.push('  ↑ 判线应落在「真纹的下分位」与「碎纹」之间。样本不足 30 只手不要动它。')
  } else {
    L.push('  （没有任何线被归类出来 —— 要么样本太少，要么闸门全挡住了，两者都值得看一眼）')
  }
  L.push('')

  L.push('三、掌丘取样圆')
  L.push('  丘        圆心x  外沿x  取样数中位  亮度偏移中位')
  for (const p of mountProbes(S)) {
    L.push(
      `  ${p.key.padEnd(8)} ${fmt(p.centerX)}  ${fmt(p.outerX)}  ${String(p.medianSampleCount).padStart(8)}  ${fmt(p.medianLumaOffset)}`,
    )
  }
  L.push('  ↑ 外沿 x 明显超出 0.75（小指 MCP 的锚点）者，圆里必有非手部像素。')
  L.push('  ⚠️ 这张表能看出哪些圆不对劲，**不能**用来重定丘位 —— 那需要掌缘，')
  L.push('     而掌缘要靠分割或人工标注，这个导出里没有。')

  return L.join('\n')
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return '   ∞  '
  return v.toFixed(3).padStart(6)
}
