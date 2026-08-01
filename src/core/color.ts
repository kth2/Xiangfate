/**
 * 气色采样。sRGB → 线性 → CIELab，按多边形掩膜取中位数。
 *
 * ⚠️ 这是全项目可靠度最低的一环：白平衡、色温、化妆、屏幕补光都会严重干扰。
 * 因此：
 *   1. methodPrior 封顶 0.45（core/band.ts）
 *   2. 一律用**相对值**（区域 a* 减去全脸 a* 中位数），抵消整体色偏
 *   3. 检测到强色偏时直接标 unavailable
 *   4. 结论只允许关联作息与状态，严禁任何疾病指向（docs/07）
 */

import { median, pointInPolygon, bounds, type P2 } from './geom'

export interface Lab {
  L: number
  a: number
  b: number
}

/** sRGB (0–255) → 线性 RGB (0–1) */
function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** D65 白点 */
const Xn = 0.95047
const Yn = 1.0
const Zn = 1.08883

function f(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r)
  const G = srgbToLinear(g)
  const B = srgbToLinear(b)

  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / Xn
  const Y = (0.2126 * R + 0.7152 * G + 0.0722 * B) / Yn
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / Zn

  const fx = f(X)
  const fy = f(Y)
  const fz = f(Z)

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

export interface RegionSample {
  lab: Lab
  /** 有效像素数（已剔除高光与阴影） */
  count: number
  /** 高光像素占比 */
  gloss: number
}

/** 剔除阈值：过亮的是反光，过暗的是阴影，都不能代表肤色 */
const HIGHLIGHT_L = 95
const SHADOW_L = 20

/**
 * 在多边形区域内采样肤色。
 * @param poly 归一化坐标（0–1）的多边形顶点
 * @param step 采样步长（像素），越大越快
 */
export function sampleRegion(img: ImageData, poly: P2[], step = 2): RegionSample | null {
  const { width, height, data } = img
  const b = bounds(poly)

  const x0 = Math.max(0, Math.floor(b.minX * width))
  const x1 = Math.min(width - 1, Math.ceil(b.maxX * width))
  const y0 = Math.max(0, Math.floor(b.minY * height))
  const y1 = Math.min(height - 1, Math.ceil(b.maxY * height))
  if (x1 <= x0 || y1 <= y0) return null

  const Ls: number[] = []
  const as: number[] = []
  const bs: number[] = []
  let total = 0
  let highlights = 0

  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      if (!pointInPolygon({ x: x / width, y: y / height }, poly)) continue
      const i = (y * width + x) * 4
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2])
      total++
      if (lab.L > HIGHLIGHT_L) {
        highlights++
        continue
      }
      if (lab.L < SHADOW_L) continue
      Ls.push(lab.L)
      as.push(lab.a)
      bs.push(lab.b)
    }
  }

  if (Ls.length < 20) return null

  return {
    lab: { L: median(Ls), a: median(as), b: median(bs) },
    count: Ls.length,
    gloss: total ? highlights / total : 0,
  }
}

export interface ComplexionResult {
  /** 各区域的绝对 Lab */
  regions: Record<string, Lab>
  /** 全脸中位 Lab，作为相对基准 */
  overall: Lab
  /** 相对红润度：区域 a* − 全脸 a*，抵消白平衡 */
  aRel: number
  /** 相对黄度 */
  bRel: number
  /** 明度均匀度 0–1，越高越匀 */
  uniformity: number
  /** 高光占比 */
  gloss: number
  /** 整体色偏严重（白平衡不可信）→ 调用方应标 unavailable */
  colorCast: boolean
}

/**
 * 综合气色分析。
 * @param regions 区域名 → 归一化多边形
 */
export function analyzeComplexion(
  img: ImageData,
  regions: Record<string, P2[]>,
): ComplexionResult | null {
  const samples: Record<string, RegionSample> = {}
  for (const [name, poly] of Object.entries(regions)) {
    const s = sampleRegion(img, poly)
    if (s) samples[name] = s
  }

  const names = Object.keys(samples)
  if (names.length < 2) return null

  const allL = names.map((n) => samples[n].lab.L)
  const allA = names.map((n) => samples[n].lab.a)
  const allB = names.map((n) => samples[n].lab.b)

  const overall: Lab = { L: median(allL), a: median(allA), b: median(allB) }

  // 颧部（左右颧）相对全脸的红度 —— 传统「气色」主要看颧
  const cheeks = names.filter((n) => n.includes('颧'))
  const cheekA = cheeks.length ? median(cheeks.map((n) => samples[n].lab.a)) : overall.a
  const cheekB = cheeks.length ? median(cheeks.map((n) => samples[n].lab.b)) : overall.b

  const spread = Math.sqrt(allL.reduce((s, l) => s + (l - overall.L) ** 2, 0) / allL.length)
  const uniformity = Math.min(1, Math.max(0, 1 - spread / Math.max(overall.L, 1)))

  return {
    regions: Object.fromEntries(names.map((n) => [n, samples[n].lab])),
    overall,
    aRel: +(cheekA - overall.a).toFixed(2),
    bRel: +(cheekB - overall.b).toFixed(2),
    uniformity: +uniformity.toFixed(2),
    gloss: +(names.reduce((s, n) => s + samples[n].gloss, 0) / names.length).toFixed(3),
    // 整体 a*/b* 极端 → 相机白平衡失准或环境光有强色，气色不可信
    colorCast: Math.abs(overall.a) > 22 || overall.b > 35 || overall.b < -8,
  }
}

/** 全图中位明度 L*（0–100）。比 image.ts 的 0–255 亮度更贴近人眼感知，用于光照门控 */
export function meanLuminanceLab(img: ImageData, step = 8): number {
  const { width, height, data } = img
  const Ls: number[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      Ls.push(rgbToLab(data[i], data[i + 1], data[i + 2]).L)
    }
  }
  return +median(Ls).toFixed(1)
}

/** 全图色偏检测，用于质量门控（在检测到人脸之前就能跑） */
export function detectColorCast(img: ImageData, step = 8): { a: number; b: number; cast: boolean } {
  const { width, height, data } = img
  const as: number[] = []
  const bs: number[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const lab = rgbToLab(data[i], data[i + 1], data[i + 2])
      if (lab.L < SHADOW_L || lab.L > HIGHLIGHT_L) continue
      as.push(lab.a)
      bs.push(lab.b)
    }
  }
  const a = median(as)
  const b = median(bs)
  return { a: +a.toFixed(2), b: +b.toFixed(2), cast: Math.abs(a) > 12 || Math.abs(b) > 24 }
}
