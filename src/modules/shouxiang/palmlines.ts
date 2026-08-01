/**
 * 掌纹归类与度量。
 *
 * 追踪出来的折线本身没有身份，靠**位置先验打分**归到四大主线：
 * 起点区、终点区、主方向、曲率符号、长度合理性，加权求分，取最高者。
 * 分数低于门槛就标 unavailable —— 宁可让用户手动校正，也不凭空生成掌纹判断。
 */

import { dist, sagittaRatio, signedSagittaRatio, type P2 } from '@/core/geom'
import type { Polyline } from '@/cv/trace'
import type { PalmLineName } from '@/core/types'
import { CANVAS } from './landmarks'

/** 低于此分数视为没测到 */
export const MATCH_THRESHOLD = 0.45

interface Zone {
  x: [number, number]
  y: [number, number]
}

interface LinePrior {
  start: Zone
  end: Zone
  /** 期望主方向角（度），0 = 水平向右，90 = 垂直向上 */
  orientation: number
  /** 方向容差（度） */
  orientationTol: number
  /** 期望曲率符号：1 = 向下凸，-1 = 向上凸，0 = 不限 */
  curveSign: number
  /** 期望长度（占掌宽的比例）区间 */
  length: [number, number]
}

/**
 * 标准掌画布上的位置先验（比例坐标）。
 * x: 0 拇指侧 → 1 小指侧；y: 0 指根 → 1 腕部
 */
const PRIORS: Record<PalmLineName, LinePrior> = {
  生命线: {
    start: { x: [0.05, 0.42], y: [0.12, 0.42] },
    end: { x: [0.15, 0.55], y: [0.68, 1.0] },
    orientation: -75,
    orientationTol: 45,
    curveSign: -1,
    length: [0.5, 1.6],
  },
  智慧线: {
    start: { x: [0.05, 0.45], y: [0.28, 0.55] },
    end: { x: [0.55, 1.0], y: [0.35, 0.72] },
    orientation: 8,
    orientationTol: 35,
    curveSign: 0,
    length: [0.4, 1.3],
  },
  感情线: {
    start: { x: [0.6, 1.0], y: [0.15, 0.42] },
    end: { x: [0.1, 0.6], y: [0.15, 0.42] },
    orientation: 0,
    orientationTol: 32,
    curveSign: 1,
    length: [0.4, 1.2],
  },
  命运线: {
    start: { x: [0.3, 0.72], y: [0.65, 1.0] },
    end: { x: [0.35, 0.68], y: [0.1, 0.4] },
    orientation: 90,
    orientationTol: 28,
    curveSign: 0,
    length: [0.35, 1.2],
  },
  太阳线: {
    start: { x: [0.55, 0.85], y: [0.45, 0.8] },
    end: { x: [0.58, 0.85], y: [0.12, 0.4] },
    orientation: 90,
    orientationTol: 30,
    curveSign: 0,
    length: [0.15, 0.7],
  },
  婚姻线: {
    start: { x: [0.85, 1.0], y: [0.12, 0.35] },
    end: { x: [0.6, 0.95], y: [0.12, 0.35] },
    orientation: 0,
    orientationTol: 30,
    curveSign: 0,
    length: [0.05, 0.3],
  },
}

export interface LineMeasure {
  name: PalmLineName
  matchScore: number
  /** 折线长 ÷ 掌宽 */
  lengthRatio: number
  /** 沿线的响应均值 0–1，代表深浅 */
  depth: number
  /** 连续性 0–1 */
  continuity: number
  /** 矢高 ÷ 弦长 */
  curvature: number
  signedCurvature: number
  branches: number
  /** 是否存在近平行的第二条同类线 */
  doubled: boolean
  /** 末端是否上扬（感情线用） */
  endRising: boolean
  /** 归一化后的折线，供可视化 */
  points: P2[]
  corrected: boolean
}

/** 掌宽在标准画布上是固定的（食指 MCP ↔ 小指 MCP） */
const PALM_WIDTH_PX = CANVAS.W * 0.5

export function classifyLines(
  lines: Polyline[],
  response: Float32Array,
): Map<PalmLineName, LineMeasure> {
  const out = new Map<PalmLineName, LineMeasure>()
  const used = new Set<Polyline>()

  // 主线优先级：先定四大主线，剩下的再分给太阳线/婚姻线
  const order: PalmLineName[] = ['生命线', '感情线', '智慧线', '命运线', '太阳线', '婚姻线']

  for (const name of order) {
    const prior = PRIORS[name]
    let best: { line: Polyline; score: number; flipped: boolean } | null = null

    for (const line of lines) {
      if (used.has(line)) continue
      for (const flipped of [false, true]) {
        const pts = flipped ? [...line.points].reverse() : line.points
        const score = scoreAgainst(pts, line, prior)
        if (!best || score > best.score) best = { line, score, flipped }
      }
    }

    if (!best || best.score < MATCH_THRESHOLD) continue

    used.add(best.line)
    const pts = best.flipped ? [...best.line.points].reverse() : best.line.points
    out.set(name, measure(name, best.line, pts, best.score, response, lines))
  }

  return out
}

function scoreAgainst(pts: P2[], line: Polyline, prior: LinePrior): number {
  if (pts.length < 2) return 0
  const a = ratio(pts[0])
  const b = ratio(pts[pts.length - 1])

  const startScore = inZone(a, prior.start)
  const endScore = inZone(b, prior.end)

  // 主方向：注意画布 y 向下，取负使「向上」为正角
  const angle = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI
  const angleDiff = Math.min(
    Math.abs(angle - prior.orientation),
    360 - Math.abs(angle - prior.orientation),
  )
  const orientScore = Math.max(0, 1 - angleDiff / (prior.orientationTol * 2))

  const lenRatio = line.length / PALM_WIDTH_PX
  const lenScore =
    lenRatio >= prior.length[0] && lenRatio <= prior.length[1]
      ? 1
      : Math.max(0, 1 - Math.min(
          Math.abs(lenRatio - prior.length[0]),
          Math.abs(lenRatio - prior.length[1]),
        ) / 0.5)

  let curveScore = 1
  if (prior.curveSign !== 0) {
    const sc = signedSagittaRatio(pts)
    curveScore = Math.sign(sc) === prior.curveSign ? 1 : 0.35
  }

  return (
    startScore * 0.3 + endScore * 0.25 + orientScore * 0.2 + lenScore * 0.15 + curveScore * 0.1
  )
}

function ratio(p: P2): P2 {
  return { x: p.x / CANVAS.W, y: p.y / CANVAS.H }
}

/** 落在区内得 1；区外按距离线性衰减 */
function inZone(p: P2, z: Zone): number {
  const dx = p.x < z.x[0] ? z.x[0] - p.x : p.x > z.x[1] ? p.x - z.x[1] : 0
  const dy = p.y < z.y[0] ? z.y[0] - p.y : p.y > z.y[1] ? p.y - z.y[1] : 0
  const d = Math.hypot(dx, dy)
  return Math.max(0, 1 - d / 0.35)
}

function measure(
  name: PalmLineName,
  line: Polyline,
  pts: P2[],
  score: number,
  response: Float32Array,
  all: Polyline[],
): LineMeasure {
  // 深浅：沿线采样 Gabor 响应
  let sum = 0
  let n = 0
  for (const p of pts) {
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (x < 0 || y < 0 || x >= CANVAS.W || y >= CANVAS.H) continue
    sum += response[y * CANVAS.W + x]
    n++
  }
  const depth = n ? Math.min(1, sum / n / 255) : 0

  const lengthRatio = line.length / PALM_WIDTH_PX
  // 断口越多、越长，连续性越差
  const continuity = Math.max(0, 1 - (line.gaps * 12) / Math.max(1, line.length))

  const a = pts[0]
  const b = pts[pts.length - 1]
  const endRising = b.y < a.y

  // 双线：找一条近平行且距离很近的同向线
  const doubled = all.some((other) => {
    if (other === line || other.points.length < 3) return false
    const oa = other.points[0]
    const ob = other.points[other.points.length - 1]
    const near = dist(oa, a) < PALM_WIDTH_PX * 0.18 && dist(ob, b) < PALM_WIDTH_PX * 0.25
    return near && Math.abs(other.length - line.length) / Math.max(other.length, line.length) < 0.4
  })

  return {
    name,
    matchScore: +score.toFixed(2),
    lengthRatio: +lengthRatio.toFixed(2),
    depth: +depth.toFixed(2),
    continuity: +continuity.toFixed(2),
    curvature: +sagittaRatio(pts).toFixed(3),
    signedCurvature: +signedSagittaRatio(pts).toFixed(3),
    branches: line.branches,
    doubled,
    endRising,
    points: pts,
    corrected: false,
  }
}

/** 用户手动校正后，按同一套流程重新度量 */
export function measureCorrected(
  name: PalmLineName,
  points: P2[],
  response: Float32Array,
): LineMeasure {
  let len = 0
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i])
  const fake: Polyline = { points, length: len, gaps: 0, branches: 0 }
  const m = measure(name, fake, points, MATCH_THRESHOLD, response, [fake])
  return { ...m, corrected: true, matchScore: MATCH_THRESHOLD }
}

export { PRIORS }
