/**
 * 骨架图 → 折线。
 *
 * 细化之后得到的是 1px 宽的像素骨架，还不能直接度量。
 * 这里把它追踪成一条条 polyline，并合并那些被断口切开、
 * 但方向一致的相邻段 —— 掌纹经常因为光照或褶皱不连续。
 */

import type { P2 } from '@/core/geom'
import { dist } from '@/core/geom'

export interface Polyline {
  points: P2[]
  /** 折线总长（像素） */
  length: number
  /** 沿线的断口数（合并时统计） */
  gaps: number
  /** 分叉点数 */
  branches: number
}

const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const

function neighborCount(bin: Uint8Array, w: number, h: number, x: number, y: number): number {
  let c = 0
  for (const [dx, dy] of NEIGHBORS) {
    const xx = x + dx
    const yy = y + dy
    if (xx >= 0 && yy >= 0 && xx < w && yy < h && bin[yy * w + xx]) c++
  }
  return c
}

/**
 * 追踪骨架为折线集合。
 * 从端点（邻居数 = 1）出发；若无端点则从任意点出发（闭环）。
 */
export function traceSkeleton(bin: Uint8Array, width: number, height: number): Polyline[] {
  const visited = new Uint8Array(bin.length)
  const lines: Polyline[] = []

  const endpoints: number[] = []
  const junctions = new Set<number>()
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (!bin[i]) continue
      const n = neighborCount(bin, width, height, x, y)
      if (n === 1) endpoints.push(i)
      else if (n > 2) junctions.add(i)
    }
  }

  const walk = (start: number): Polyline | null => {
    if (visited[start]) return null
    const pts: P2[] = []
    let branches = 0
    let cur = start

    for (;;) {
      visited[cur] = 1
      const x = cur % width
      const y = (cur / width) | 0
      pts.push({ x, y })
      if (junctions.has(cur)) branches++

      let next = -1
      for (const [dx, dy] of NEIGHBORS) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const j = yy * width + xx
        if (bin[j] && !visited[j]) {
          next = j
          break
        }
      }
      if (next < 0) break
      cur = next
    }

    if (pts.length < 5) return null
    return {
      points: simplify(pts, 1.5),
      length: pathLen(pts),
      gaps: 0,
      branches: Math.max(0, branches - 1),
    }
  }

  for (const e of endpoints) {
    const l = walk(e)
    if (l) lines.push(l)
  }
  // 闭环等没有端点的部分
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] && !visited[i]) {
      const l = walk(i)
      if (l) lines.push(l)
    }
  }

  return lines
}

function pathLen(pts: P2[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
  return L
}

/** Ramer–Douglas–Peucker 抽稀，去掉锯齿又保留形状 */
export function simplify(pts: P2[], epsilon: number): P2[] {
  if (pts.length < 3) return pts
  let maxDist = 0
  let idx = 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const norm = Math.hypot(dx, dy) || 1

  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / norm
    if (d > maxDist) {
      maxDist = d
      idx = i
    }
  }
  if (maxDist <= epsilon) return [a, b]
  return [...simplify(pts.slice(0, idx + 1), epsilon).slice(0, -1), ...simplify(pts.slice(idx), epsilon)]
}

/**
 * 合并被断口切开但方向一致的相邻段。
 * @param maxGap 端点距离上限（像素）
 * @param maxAngle 方向夹角上限（度）
 */
export function mergeCollinear(lines: Polyline[], maxGap = 12, maxAngle = 25): Polyline[] {
  const result = lines.map((l) => ({ ...l, points: [...l.points] }))
  let merged = true

  while (merged) {
    merged = false
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const A = result[i]
        const B = result[j]
        const combo = tryJoin(A, B, maxGap, maxAngle)
        if (combo) {
          result[i] = combo
          result.splice(j, 1)
          merged = true
          break outer
        }
      }
    }
  }
  return result
}

function tryJoin(A: Polyline, B: Polyline, maxGap: number, maxAngle: number): Polyline | null {
  const ends = [
    { a: A.points[A.points.length - 1], b: B.points[0], flipA: false, flipB: false },
    { a: A.points[A.points.length - 1], b: B.points[B.points.length - 1], flipA: false, flipB: true },
    { a: A.points[0], b: B.points[0], flipA: true, flipB: false },
    { a: A.points[0], b: B.points[B.points.length - 1], flipA: true, flipB: true },
  ]

  for (const e of ends) {
    const gap = dist(e.a, e.b)
    if (gap > maxGap) continue

    const pa = e.flipA ? A.points.slice().reverse() : A.points
    const pb = e.flipB ? B.points.slice().reverse() : B.points
    const dirA = direction(pa[Math.max(0, pa.length - 4)], pa[pa.length - 1])
    const dirB = direction(pb[0], pb[Math.min(pb.length - 1, 3)])
    const angle = angleBetween(dirA, dirB)
    if (angle > maxAngle) continue

    return {
      points: [...pa, ...pb],
      length: A.length + B.length + gap,
      gaps: A.gaps + B.gaps + 1,
      branches: A.branches + B.branches,
    }
  }
  return null
}

function direction(a: P2, b: P2): P2 {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const n = Math.hypot(dx, dy) || 1
  return { x: dx / n, y: dy / n }
}

function angleBetween(a: P2, b: P2): number {
  const dot = Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y))
  return (Math.acos(dot) * 180) / Math.PI
}
