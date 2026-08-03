/**
 * 面部标记的像素级检测：痣/斑、卧蚕、法令纹。
 *
 * 这三项原来都不在特征库里 —— 痣标 out_of_scope，卧蚕与法令纹压根没做。
 * 而传统相法里它们恰恰是断语最多的地方（痣按十二宫位断、卧蚕主男女宫、
 * 法令主威权与晚运），缺了这块，报告只能停在骨架比例上。
 *
 * ⚠️ 三者都是**从像素推断**，不是几何测量：
 *   · 痣会与痘、雀斑、压缩噪点、镜框、胡茬混淆
 *   · 卧蚕与法令纹靠明暗起伏判断，受光照方向影响很大
 * 因此全部以 inferred 出具，且各自带一条「测不出来就明说」的退出路径：
 * 候选点过多（多半是雀斑或噪点）时整项作废，宁可标 unavailable 也不硬报。
 */

import { bounds, median, pointInPolygon, type P2, type P3 } from '@/core/geom'
import { BROW, EYE, FACE_OVAL, IOD_PAIR, MOUTH, NOSE } from './landmarks'

export interface Mole {
  /** 归一化坐标（0–1） */
  x: number
  y: number
  /** 直径 ÷ IOD */
  sizeRatio: number
  /** 相对周围肤色的暗度落差，0–1，越大越明显 */
  contrast: number
  position: MolePosition
}

export type MolePosition =
  | '印堂'
  | '额中'
  | '额角'
  | '眉'
  | '眼尾'
  | '眼下'
  | '山根'
  | '鼻梁'
  | '准头'
  | '鼻翼'
  | '颧'
  | '人中'
  | '唇周'
  | '法令'
  | '地阁'
  | '腮'
  | '面颊'

export interface MoleResult {
  moles: Mole[]
  /** 检测不可用时给出原因，供 unavailable 如实说明 */
  failed: 'too_noisy' | 'roi_too_small' | null
}

export interface EyeBagResult {
  /** 卧蚕隆起：亮脊 + 其下暗沟的落差，0–1 */
  ridge: number
  /** 泪堂深陷：眼下带比颊部明显更暗的程度，0–1 */
  hollow: number
}

export interface NasolabialResult {
  /** 纹深：沿线各处的局部暗度中位数，0–1 */
  depth: number
  /** 连续性：能测到清晰凹线的采样点占比，0–1 */
  continuity: number
  /** 是否延伸过口角水平线（传统「法令入口」的判定前提） */
  pastMouthCorner: boolean
}

/* ============================================================
   痣 / 斑点
   ============================================================ */

/** 一张脸上超过这个数，基本可以断定是雀斑、痘或噪点，而不是痣 */
const MAX_PLAUSIBLE_MOLES = 12

export function detectMoles(img: ImageData, lm: P3[]): MoleResult {
  const iod = iodPx(lm, img.width)
  if (iod < 40) return { moles: [], failed: 'roi_too_small' }

  const oval = FACE_OVAL.map((i) => pt(lm[i]))
  // 向内收一圈：轮廓边缘混着头发、耳朵与背景，误检最多
  const skin = shrinkPolygon(oval, 0.92)
  const b = bounds(skin)

  const x0 = Math.max(0, Math.floor(b.minX * img.width))
  const x1 = Math.min(img.width - 1, Math.ceil(b.maxX * img.width))
  const y0 = Math.max(0, Math.floor(b.minY * img.height))
  const y1 = Math.min(img.height - 1, Math.ceil(b.maxY * img.height))
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  if (w < 32 || h < 32) return { moles: [], failed: 'roi_too_small' }

  // 灰度 + 积分图：局部均值要在每个像素上算两次，没有积分图会慢一个量级
  const gray = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y + y0) * img.width + (x + x0)) * 4
      gray[y * w + x] = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
    }
  }
  const integral = buildIntegral(gray, w, h)

  // 痣的尺度：小窗取痣本体，大窗取周围肤色作基线
  const rs = Math.max(1, Math.round(iod * 0.008))
  const rl = Math.max(rs + 3, Math.round(iod * 0.05))

  const exclude = exclusionPolys(lm, iod, img.width, img.height)
  const mask = new Uint8Array(w * h)

  for (let y = rl; y < h - rl; y++) {
    for (let x = rl; x < w - rl; x++) {
      const px = { x: (x + x0) / img.width, y: (y + y0) / img.height }
      if (!pointInPolygon(px, skin)) continue
      if (exclude.some((poly) => pointInPolygon(px, poly))) continue

      const small = boxMean(integral, w, x - rs, y - rs, x + rs, y + rs)
      const large = boxMean(integral, w, x - rl, y - rl, x + rl, y + rl)
      if (large <= 1) continue
      // 比周围肤色暗 13% 以上才算候选
      if ((large - small) / large > 0.13) mask[y * w + x] = 1
    }
  }

  const blobs = connectedBlobs(mask, w, h)
  const minArea = Math.max(2, Math.round(Math.PI * rs * rs * 0.4))
  const maxArea = Math.round(Math.PI * (iod * 0.035) ** 2)

  const moles: Mole[] = []
  for (const blob of blobs) {
    if (blob.area < minArea || blob.area > maxArea) continue
    const bw = blob.maxX - blob.minX + 1
    const bh = blob.maxY - blob.minY + 1
    // 痣是团状的：长条形（皱纹、镜框、发丝）与稀疏散点都排除
    if (bw / bh > 2.5 || bh / bw > 2.5) continue
    if (blob.area / (bw * bh) < 0.45) continue

    const cx = (blob.sumX / blob.area + x0) / img.width
    const cy = (blob.sumY / blob.area + y0) / img.height
    const around = boxMean(
      integral, w,
      blob.minX - rl, blob.minY - rl, blob.maxX + rl, blob.maxY + rl,
    )
    const inside = boxMean(integral, w, blob.minX, blob.minY, blob.maxX, blob.maxY)

    moles.push({
      x: +cx.toFixed(4),
      y: +cy.toFixed(4),
      sizeRatio: +(Math.max(bw, bh) / iod).toFixed(4),
      contrast: +Math.min(1, (around - inside) / Math.max(around, 1)).toFixed(3),
      position: classifyPosition({ x: cx, y: cy }, lm, iod, img.width, img.height),
    })
  }

  // 满脸「痣」= 雀斑/痘/噪点。这种情况下一个都不报，比报错更诚实
  if (moles.length > MAX_PLAUSIBLE_MOLES) return { moles: [], failed: 'too_noisy' }

  moles.sort((a, b) => b.contrast - a.contrast)
  return { moles: moles.slice(0, 6), failed: null }
}

/**
 * 痣的位置 → 传统宫位名。
 * 按优先级逐个多边形测试：小而具体的区域排前面，面颊兜底。
 */
function classifyPosition(p: P2, lm: P3[], iod: number, w: number, h: number): MolePosition {
  const r = iod / w // 归一化后的 IOD（x 方向）
  const ry = iod / h
  const near = (i: number, kx: number, ky = kx) =>
    Math.abs(p.x - lm[i].x) < r * kx && Math.abs(p.y - lm[i].y) < ry * ky

  if (near(9, 0.22, 0.18)) return '印堂'
  if (near(168, 0.16, 0.14)) return '山根'
  if (near(4, 0.2, 0.16)) return '准头'
  if (near(NOSE.alarLeft, 0.16) || near(NOSE.alarRight, 0.16)) return '鼻翼'
  if (near(6, 0.14, 0.22)) return '鼻梁'
  if (near(2, 0.14, 0.16) || near(164, 0.14, 0.14)) return '人中'

  const browPoly = [...BROW.left.all, ...BROW.right.all]
  if (browPoly.some((i) => near(i, 0.1, 0.12))) return '眉'
  if (near(EYE.left.outer, 0.28, 0.2) || near(EYE.right.outer, 0.28, 0.2)) return '眼尾'
  if (near(EYE.left.lower, 0.2, 0.3) || near(EYE.right.lower, 0.2, 0.3)) return '眼下'

  if (near(MOUTH.cornerLeft, 0.2) || near(MOUTH.cornerRight, 0.2)) return '唇周'
  if (near(MOUTH.upperOuter, 0.35, 0.2) || near(MOUTH.lowerOuter, 0.35, 0.2)) return '唇周'

  // 法令：鼻翼 → 口角连线附近
  for (const [alar, corner] of [
    [NOSE.alarLeft, MOUTH.cornerLeft],
    [NOSE.alarRight, MOUTH.cornerRight],
  ] as const) {
    if (distToSegment(p, pt(lm[alar]), pt(lm[corner])) < r * 0.18) return '法令'
  }

  if (near(152, 0.5, 0.3) || near(199, 0.45, 0.3)) return '地阁'
  if (near(234, 0.25, 0.35) || near(454, 0.25, 0.35)) return '腮'
  if (near(205, 0.3, 0.25) || near(425, 0.3, 0.25)) return '颧'
  if (near(21, 0.3, 0.25) || near(251, 0.3, 0.25)) return '额角'
  if (p.y < lm[9].y) return '额中'
  return '面颊'
}

/** 眼、眉、鼻孔、唇：这些天生就暗，全部排除，否则每张脸都能「测出」几十颗痣 */
function exclusionPolys(lm: P3[], iod: number, w: number, h: number): P2[][] {
  const pad = (idxs: readonly number[], k: number) =>
    inflate(idxs.map((i) => pt(lm[i])), (iod * k) / w, (iod * k) / h)

  // 鼻孔单独按点做小区 —— 早先把两个鼻孔连同鼻小柱围成一个三角形再外扩，
  // 结果把准头一并吞了，鼻头上的痣永远测不到
  const around = (i: number, k: number): P2[] => {
    const rx = (iod * k) / w
    const ry = (iod * k) / h
    const c = pt(lm[i])
    return [
      { x: c.x, y: c.y - ry },
      { x: c.x + rx, y: c.y },
      { x: c.x, y: c.y + ry },
      { x: c.x - rx, y: c.y },
    ]
  }

  return [
    pad([EYE.left.outer, EYE.left.upper, EYE.left.inner, EYE.left.lower], 0.16),
    pad([EYE.right.outer, EYE.right.upper, EYE.right.inner, EYE.right.lower], 0.16),
    pad(BROW.left.all, 0.1),
    pad(BROW.right.all, 0.1),
    pad([MOUTH.cornerLeft, MOUTH.upperOuter, MOUTH.cornerRight, MOUTH.lowerOuter], 0.1),
    around(NOSE.nostrilLeft, 0.1),
    around(NOSE.nostrilRight, 0.1),
  ]
}

/* ============================================================
   卧蚕 / 泪堂（男女宫）
   ============================================================ */

/**
 * 卧蚕是下睑缘下方那道隆起：受光时呈「亮脊 + 其下暗沟」。
 * 泪堂深陷则相反 —— 整条眼下带比颊部更暗。两者各测一个量，分开出具。
 */
export function measureEyeBag(img: ImageData, lm: P3[], side: 'left' | 'right'): EyeBagResult {
  const e = EYE[side]
  const lid = pt(lm[e.lower])
  const inner = pt(lm[e.inner])
  const outer = pt(lm[e.outer])
  const iod = iodPx(lm, img.width)
  const stripH = (iod * 0.13) / img.height

  const rowMean = (yNorm: number): number | null => {
    const y = Math.round(yNorm * img.height)
    if (y < 0 || y >= img.height) return null
    const xa = Math.round(Math.min(inner.x, outer.x) * img.width)
    const xb = Math.round(Math.max(inner.x, outer.x) * img.width)
    const vals: number[] = []
    for (let x = Math.max(0, xa); x <= Math.min(img.width - 1, xb); x++) {
      const i = (y * img.width + x) * 4
      vals.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
    }
    return vals.length >= 6 ? median(vals) : null
  }

  const N = 12
  const profile: number[] = []
  for (let k = 0; k <= N; k++) {
    const v = rowMean(lid.y + (stripH * k) / N)
    if (v === null) return { ridge: 0, hollow: 0 }
    profile.push(v)
  }

  // 亮脊在上半段，暗沟在其下
  let peakIdx = 0
  for (let k = 1; k <= Math.floor(N / 2); k++) if (profile[k] > profile[peakIdx]) peakIdx = k
  let troughIdx = peakIdx
  for (let k = peakIdx; k <= N; k++) if (profile[k] < profile[troughIdx]) troughIdx = k

  const peak = profile[peakIdx]
  const trough = profile[troughIdx]
  const ridge = peak > 1 ? Math.max(0, (peak - trough) / peak) : 0

  // 颊部基准取眼下带再往下一段
  const cheek = rowMean(lid.y + stripH * 1.9)
  const bandMin = Math.min(...profile)
  const hollow = cheek && cheek > 1 ? Math.max(0, (cheek - bandMin) / cheek) : 0

  return { ridge: +Math.min(1, ridge).toFixed(3), hollow: +Math.min(1, hollow).toFixed(3) }
}

/* ============================================================
   法令纹
   ============================================================ */

/**
 * 沿鼻翼 → 口角方向逐点扫描，在每个采样点的**垂线**上找最暗处。
 * 纹沟是一条连续的局部低谷 —— 用「有多少个采样点找得到低谷」来量连续性，
 * 比单纯看某处深浅稳。
 */
export function measureNasolabial(
  img: ImageData,
  lm: P3[],
  side: 'left' | 'right',
): NasolabialResult {
  const alar = pt(lm[side === 'left' ? NOSE.alarLeft : NOSE.alarRight])
  const corner = pt(lm[side === 'left' ? MOUTH.cornerLeft : MOUTH.cornerRight])
  const iod = iodPx(lm, img.width)

  // 向下外侧延长 40%：法令过口角与否是传统关注点
  const end = { x: alar.x + (corner.x - alar.x) * 1.4, y: alar.y + (corner.y - alar.y) * 1.4 }
  const dx = end.x - alar.x
  const dy = end.y - alar.y
  const len = Math.hypot(dx * img.width, dy * img.height)
  if (len < 12) return { depth: 0, continuity: 0, pastMouthCorner: false }

  // 垂线方向（归一化坐标下的单位法向）
  const nx = -dy / Math.hypot(dx, dy)
  const ny = dx / Math.hypot(dx, dy)
  const halfW = (iod * 0.07) / img.width

  const N = 20
  const depths: number[] = []
  let clear = 0
  let clearBelowCorner = 0
  let belowCornerTotal = 0

  for (let k = 2; k <= N; k++) {
    const t = k / N
    const cx = alar.x + dx * t
    const cy = alar.y + dy * t

    const vals: number[] = []
    const M = 14
    for (let j = -M; j <= M; j++) {
      const x = Math.round((cx + nx * halfW * (j / M)) * img.width)
      const y = Math.round((cy + ny * halfW * (j / M)) * img.height)
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
      const i = (y * img.width + x) * 4
      vals.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2])
    }
    if (vals.length < 10) continue

    const base = median(vals)
    const lo = Math.min(...vals)
    const d = base > 1 ? (base - lo) / base : 0
    depths.push(d)

    const isClear = d > 0.07
    if (isClear) clear++
    if (cy > corner.y) {
      belowCornerTotal++
      if (isClear) clearBelowCorner++
    }
  }

  if (!depths.length) return { depth: 0, continuity: 0, pastMouthCorner: false }

  return {
    depth: +Math.min(1, median(depths)).toFixed(3),
    continuity: +(clear / depths.length).toFixed(3),
    // 口角以下仍有一半以上采样点看得到纹沟，才算延伸过口角
    pastMouthCorner: belowCornerTotal >= 3 && clearBelowCorner / belowCornerTotal >= 0.5,
  }
}

/* ============================================================
   小工具
   ============================================================ */

const pt = (p: P3 | P2): P2 => ({ x: p.x, y: p.y })

function iodPx(lm: P3[], width: number): number {
  const [a, b] = IOD_PAIR
  return Math.abs(lm[a].x - lm[b].x) * width
}

function buildIntegral(gray: Float32Array, w: number, h: number): Float64Array {
  const s = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x]
      s[(y + 1) * (w + 1) + (x + 1)] = s[y * (w + 1) + (x + 1)] + rowSum
    }
  }
  return s
}

/** 闭区间 [x0,x1]×[y0,y1] 的均值 */
function boxMean(
  integral: Float64Array,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const W = w + 1
  const a = Math.max(0, x0)
  const b = Math.max(0, y0)
  const c = Math.min(w - 1, x1)
  const d = Math.min(integral.length / W - 2, y1)
  if (c < a || d < b) return 0
  const sum =
    integral[(d + 1) * W + (c + 1)] -
    integral[b * W + (c + 1)] -
    integral[(d + 1) * W + a] +
    integral[b * W + a]
  return sum / ((c - a + 1) * (d - b + 1))
}

interface Blob {
  area: number
  sumX: number
  sumY: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** 四连通分量。用显式栈而不是递归 —— 大团块会把调用栈打爆 */
function connectedBlobs(mask: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(w * h)
  const blobs: Blob[] = []
  const stack: number[] = []

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    const blob: Blob = {
      area: 0, sumX: 0, sumY: 0,
      minX: w, maxX: 0, minY: h, maxY: 0,
    }

    while (stack.length) {
      const idx = stack.pop()!
      const x = idx % w
      const y = (idx - x) / w
      blob.area++
      blob.sumX += x
      blob.sumY += y
      if (x < blob.minX) blob.minX = x
      if (x > blob.maxX) blob.maxX = x
      if (y < blob.minY) blob.minY = y
      if (y > blob.maxY) blob.maxY = y

      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1) }
      if (x < w - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1) }
      if (y > 0 && mask[idx - w] && !seen[idx - w]) { seen[idx - w] = 1; stack.push(idx - w) }
      if (y < h - 1 && mask[idx + w] && !seen[idx + w]) { seen[idx + w] = 1; stack.push(idx + w) }
    }
    blobs.push(blob)
  }
  return blobs
}

function centroid(poly: P2[]): P2 {
  const n = poly.length || 1
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  }
}

/** 向质心收缩，用来把轮廓边缘（头发、耳、背景）排除在外 */
function shrinkPolygon(poly: P2[], k: number): P2[] {
  const c = centroid(poly)
  return poly.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }))
}

/** 向外膨胀一圈，用于生成排除区 */
function inflate(poly: P2[], padX: number, padY: number): P2[] {
  const c = centroid(poly)
  return poly.map((p) => {
    const vx = p.x - c.x
    const vy = p.y - c.y
    const n = Math.hypot(vx, vy) || 1
    return { x: p.x + (vx / n) * padX, y: p.y + (vy / n) * padY }
  })
}

function distToSegment(p: P2, a: P2, b: P2): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2))
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t))
}
