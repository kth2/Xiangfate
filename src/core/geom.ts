/**
 * 关键点几何工具。纯函数，无副作用，无 DOM —— 迁移 RN/Flutter 时整体复用。
 * 所有函数接受归一化坐标（0–1）或世界坐标（米），由调用方保证一致。
 */

export interface P2 {
  x: number
  y: number
}
export interface P3 extends P2 {
  z: number
}

export const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y })
export const add = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y })
export const scale = (a: P2, k: number): P2 => ({ x: a.x * k, y: a.y * k })

export function dist(a: P2, b: P2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function dist3(a: P3, b: P3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function mid(...pts: P2[]): P2 {
  const n = pts.length
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  }
}

/** 折线总长 */
export function pathLength(pts: P2[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
  return L
}

/**
 * 点到直线 ab 的垂直距离（有符号：左正右负）。
 * 用于鼻梁偏移、掌线曲率。
 */
export function signedDistToLine(p: P2, a: P2, b: P2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return dist(p, a)
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / len
}

/**
 * 曲率代理：矢高 ÷ 弦长。
 * 0 = 直线；越大越弯。比拟合圆便宜得多，且对眉/掌线足够。
 */
export function sagittaRatio(pts: P2[]): number {
  if (pts.length < 3) return 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  const chord = dist(a, b)
  if (chord < 1e-9) return 0
  let maxSag = 0
  for (let i = 1; i < pts.length - 1; i++) {
    maxSag = Math.max(maxSag, Math.abs(signedDistToLine(pts[i], a, b)))
  }
  return maxSag / chord
}

/** 带符号的矢高比：正 = 向某侧凸，用于区分上扬 / 下垂 */
export function signedSagittaRatio(pts: P2[]): number {
  if (pts.length < 3) return 0
  const a = pts[0]
  const b = pts[pts.length - 1]
  const chord = dist(a, b)
  if (chord < 1e-9) return 0
  let best = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = signedDistToLine(pts[i], a, b)
    if (Math.abs(d) > Math.abs(best)) best = d
  }
  return best / chord
}

/** 从 a 指向 b 的方向角（度）。图像坐标下 y 向下，故取负号使「上扬」为正 */
export function angleDeg(a: P2, b: P2): number {
  return (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI
}

/**
 * b 相对 a 的**仰角**（度），与左右方向无关：正 = b 更高。
 * 用于外眦上扬、眉尾上扬这类「左右两侧要得到同一个数」的度量 ——
 * 直接用 angleDeg 会让一侧得到接近 ±180° 的结果。
 */
export function elevationDeg(a: P2, b: P2): number {
  const dx = Math.abs(b.x - a.x)
  if (dx < 1e-9) return b.y < a.y ? 90 : -90
  return (Math.atan2(-(b.y - a.y), dx) * 180) / Math.PI
}

/** 三点夹角（度），顶点为 b */
export function angleAt(a: P2, b: P2, c: P2): number {
  const v1 = sub(a, b)
  const v2 = sub(c, b)
  const d = v1.x * v2.x + v1.y * v2.y
  const m = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)
  if (m < 1e-9) return 0
  return (Math.acos(Math.min(1, Math.max(-1, d / m))) * 180) / Math.PI
}

/** 多边形面积（鞋带公式，取绝对值） */
export function polygonArea(pts: P2[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y)
  }
  return Math.abs(a / 2)
}

/** 点是否在多边形内（射线法）。用于像素采样掩膜 */
export function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].y
    const yj = poly[j].y
    if (yi > p.y !== yj > p.y) {
      const xAt = ((poly[j].x - poly[i].x) * (p.y - yi)) / (yj - yi) + poly[i].x
      if (p.x < xAt) inside = !inside
    }
  }
  return inside
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function bounds(pts: P2[]): Bounds {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x
    if (p.y < b.minY) b.minY = p.y
    if (p.x > b.maxX) b.maxX = p.x
    if (p.y > b.maxY) b.maxY = p.y
  }
  return b
}

/**
 * 用最小二乘拟合中轴线，返回过重心的方向向量（单位向量）。
 * 面部对称性评分需要先定出中线。
 */
export function principalAxis(pts: P2[]): { center: P2; dir: P2 } {
  const c = mid(...pts)
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    const dx = p.x - c.x
    const dy = p.y - c.y
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
  }
  // 主特征向量
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { center: c, dir: { x: Math.cos(theta), y: Math.sin(theta) } }
}

/** 点 p 关于过 center、方向 dir 的直线的镜像 */
export function reflectAcrossLine(p: P2, center: P2, dir: P2): P2 {
  const dx = p.x - center.x
  const dy = p.y - center.y
  const dot = dx * dir.x + dy * dir.y
  const px = dir.x * dot
  const py = dir.y * dot
  return { x: center.x + 2 * px - dx, y: center.y + 2 * py - dy }
}

/** 把一组值线性映射到 0–1 并裁剪 */
export function normalize(v: number, lo: number, hi: number): number {
  if (hi - lo < 1e-9) return 0.5
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

export function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}
