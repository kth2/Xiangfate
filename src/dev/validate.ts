/**
 * Phase 0 / Phase 1 对比验证台（纯函数部分）。
 *
 * 要回答的问题只有一个：**3D 那一层到底有没有让测量更稳。**
 * 三条轴分别对应三种不稳定来源：
 *   · 姿态       —— 同一组关键点合成旋转，看各量漂移多少（不需要额外照片，随时能跑）
 *   · 检测器抖动 —— 同一张照片连拍若干帧之间的离散度
 *   · 跨拍摄     —— 同一个人不同距离/光线/角度的多张照片之间的离散度
 *
 * ⚠️ 这里**不含任何图像**：输入是导出的关键点，输出是数字。
 * 照片始终留在浏览器里，导出的文件也不含人脸像素。
 *
 * ⚠️ 本文件是纯函数，不碰 DOM —— 于是同一套分析既能在 dev 页面里跑，
 * 也能进测试当回归夹具。
 */

import type { P3 } from '@/core/geom'
import { median } from '@/core/geom'
import { computeFace3DFeatures } from '@/modules/mianxiang/features'
import { computeFaceMetrics } from '@/modules/mianxiang/metrics'

/* ============================================================
   导出格式
   ============================================================ */

export const EXPORT_VERSION = 1

export interface LandmarkSample {
  /** 同一张照片的多帧共用一个 shotId，用来算检测器抖动 */
  shotId: string
  /** 同一个人的多张照片共用一个 subjectId，用来算跨拍摄一致性 */
  subjectId: string
  /** 人类可读的来源说明（文件名等），仅供排查 */
  label: string
  landmarks: P3[]
  imgWidth: number
  imgHeight: number
  transformMatrix?: number[]
  qualityScore?: number
}

export interface ExportBundle {
  version: number
  exportedAt: string
  samples: LandmarkSample[]
}

/* ============================================================
   两代指标的取数
   ============================================================ */

/** Phase 0：从既有的二维度量里挑出与本次对比相关的标量 */
export function phase0Metrics(s: LandmarkSample): Record<string, number> {
  const m = computeFaceMetrics(s.landmarks, s.imgWidth, s.imgHeight)
  return {
    'p0.三停.上停': m.threeCourts.upper,
    'p0.三停.中停': m.threeCourts.middle,
    'p0.三停.下停': m.threeCourts.lower,
    'p0.三停.最大差': m.threeCourts.maxDiff,
    'p0.鼻.山根': m.nose.bridgeHeight,
    'p0.鼻.准头': m.nose.tipFullness,
    'p0.鼻.鼻长': m.nose.len,
    'p0.鼻.鼻翼宽': m.nose.alarWidth,
    'p0.鼻.梁偏移': m.nose.bridgeDeviation,
    'p0.印堂.宽': m.brow.left.gapRatio,
    'p0.对称.总分': m.symmetryScore,
    'p0.五眼': m.fiveEye,
    'p0.田宅': m.tianzhai,
  }
}

/** Phase 1：3D 管线的全部产出 */
export function phase1Metrics(s: LandmarkSample): Record<string, number> {
  const r = computeFace3DFeatures({
    landmarks: s.landmarks,
    imgWidth: s.imgWidth,
    imgHeight: s.imgHeight,
    transformMatrix: s.transformMatrix,
    qualityFactor: 1,
    detectorScore: 1,
  })
  return Object.fromEntries(r.features.map((f) => [f.id, f.value as number]))
}

/**
 * 两代之间量的是同一件事的项。
 * 只有这些能直接比「谁更稳」；其余是 Phase 1 独有的，只报自身稳定性。
 */
export const PAIRS: [phase0: string, phase1: string, name: string][] = [
  ['p0.三停.上停', 'face3d.threeCourts.upper', '三停·上停'],
  ['p0.三停.中停', 'face3d.threeCourts.middle', '三停·中停'],
  ['p0.三停.下停', 'face3d.threeCourts.lower', '三停·下停'],
  ['p0.鼻.山根', 'face3d.nose.rootDepth', '鼻·山根'],
  ['p0.鼻.准头', 'face3d.nose.tipProjection', '鼻·准头'],
  ['p0.鼻.鼻长', 'face3d.nose.length', '鼻·鼻长'],
  ['p0.鼻.鼻翼宽', 'face3d.nose.alarWidth', '鼻·鼻翼宽'],
  ['p0.鼻.梁偏移', 'face3d.nose.deviation', '鼻·梁偏斜'],
  ['p0.印堂.宽', 'face3d.mingGong.width', '印堂·宽'],
  ['p0.对称.总分', 'face3d.symmetry.score', '对称·总分'],
]

/** 重点关注项：这几个是本次升级的主诉求，报告里单独置顶 */
export const FOCUS_IDS = [
  'face3d.threeCourts.upper',
  'face3d.threeCourts.middle',
  'face3d.threeCourts.lower',
  'face3d.threeCourts.balance',
  'face3d.nose.rootDepth',
  'face3d.nose.tipProjection',
  'face3d.nose.dorsumConvexity',
  'face3d.mingGong.width',
  'face3d.mingGong.fullness',
  'face3d.wuYue.zhong',
  'face3d.wuYue.dong',
  'face3d.wuYue.xi',
  'face3d.wuYue.nan',
  'face3d.wuYue.bei',
  'face3d.wuYue.support',
  'face3d.symmetry.score',
  'face3d.symmetry.depthBias',
]

/* ============================================================
   稳定性统计
   ============================================================ */

export interface Spread {
  metric: string
  n: number
  median: number
  /** 中位绝对偏差 —— 用它而不是标准差，免得被一帧离群值带偏 */
  mad: number
  /** 最大偏离中位数的幅度 */
  maxDev: number
  /**
   * 相对离散度 = mad ÷ max(|median|, floor)。
   * 不同量纲的项要横向比，只能看相对量；floor 防止接近 0 的项炸掉。
   */
  relative: number
}

const FLOOR = 0.02

export function spreadOf(metric: string, values: number[]): Spread {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length === 0) {
    return { metric, n: 0, median: NaN, mad: NaN, maxDev: NaN, relative: NaN }
  }
  const med = median(clean)
  const devs = clean.map((v) => Math.abs(v - med))
  return {
    metric,
    n: clean.length,
    median: round(med),
    mad: round(median(devs)),
    maxDev: round(Math.max(...devs)),
    relative: round(median(devs) / Math.max(Math.abs(med), FLOOR)),
  }
}

/** 把一组样本按指标名收拢成 {指标 → 各样本的值} */
function collect(
  samples: LandmarkSample[],
  extract: (s: LandmarkSample) => Record<string, number>,
): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const s of samples) {
    for (const [k, v] of Object.entries(extract(s))) {
      const arr = out.get(k) ?? []
      arr.push(v)
      out.set(k, arr)
    }
  }
  return out
}

export function spreadsOf(
  samples: LandmarkSample[],
  extract: (s: LandmarkSample) => Record<string, number>,
): Spread[] {
  return [...collect(samples, extract)].map(([k, vs]) => spreadOf(k, vs))
}

/* ============================================================
   轴一：姿态鲁棒性（不需要额外照片）
   ============================================================ */

/** 绕三轴旋转点云，模拟拍歪 */
export function rotateSample(s: LandmarkSample, deg: { yaw?: number; pitch?: number; roll?: number }): LandmarkSample {
  const { yaw = 0, pitch = 0, roll = 0 } = deg
  const rad = (d: number) => (d * Math.PI) / 180
  const [cy, sy] = [Math.cos(rad(yaw)), Math.sin(rad(yaw))]
  const [cp, sp] = [Math.cos(rad(pitch)), Math.sin(rad(pitch))]
  const [cr, sr] = [Math.cos(rad(roll)), Math.sin(rad(roll))]

  const n = s.landmarks.length || 1
  const cx0 = s.landmarks.reduce((a, p) => a + p.x, 0) / n
  const cy0 = s.landmarks.reduce((a, p) => a + p.y, 0) / n

  const landmarks = s.landmarks.map((p) => {
    let x = (p.x - cx0) * s.imgWidth
    let y = (p.y - cy0) * s.imgHeight
    let z = (p.z ?? 0) * s.imgWidth
    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    ;[y, z] = [y * cp - z * sp, y * sp + z * cp]
    ;[x, y] = [x * cr - y * sr, x * sr + y * cr]
    return { x: cx0 + x / s.imgWidth, y: cy0 + y / s.imgHeight, z: z / s.imgWidth }
  })

  return { ...s, landmarks, label: `${s.label} (yaw${yaw} pitch${pitch} roll${roll})` }
}

/** 默认的扰动集合。10° 已经超出质量门控允许的范围，放进来是为了看趋势 */
export const DEFAULT_ANGLES = [
  { yaw: 3 }, { yaw: -3 }, { yaw: 6 }, { yaw: 10 },
  { pitch: 3 }, { pitch: -3 }, { pitch: 6 },
  { roll: 5 }, { roll: -5 }, { roll: 10 },
  { yaw: 4, pitch: 3, roll: 5 },
]

export interface PoseDrift {
  metric: string
  base: number
  /** 各扰动下偏离基准的最大幅度 */
  maxDrift: number
  /** maxDrift ÷ max(|base|, floor) */
  relative: number
}

export function poseRobustness(
  sample: LandmarkSample,
  extract: (s: LandmarkSample) => Record<string, number>,
  angles = DEFAULT_ANGLES,
): PoseDrift[] {
  const base = extract(sample)
  const rotated = angles.map((a) => extract(rotateSample(sample, a)))

  return Object.keys(base).map((k) => {
    const b = base[k]
    const drift = Math.max(...rotated.map((r) => Math.abs((r[k] ?? b) - b)))
    return {
      metric: k,
      base: round(b),
      maxDrift: round(drift),
      relative: round(drift / Math.max(Math.abs(b), FLOOR)),
    }
  })
}

/* ============================================================
   完整报告
   ============================================================ */

export interface ValidationReport {
  generatedAt: string
  sampleCount: number
  subjectCount: number
  /** 轴一：姿态。两代并排 */
  pose: { pairs: PairedDrift[]; phase1Only: PoseDrift[] }
  /** 轴二：同一张照片的多帧 */
  jitter: { phase0: Spread[]; phase1: Spread[] } | null
  /** 轴三：同一个人的多张照片 */
  crossShot: { phase0: Spread[]; phase1: Spread[] } | null
}

export interface PairedDrift {
  name: string
  phase0: PoseDrift
  phase1: PoseDrift
  /** 负数 = Phase 1 更稳 */
  deltaRelative: number
}

export function buildReport(bundle: ExportBundle): ValidationReport {
  const samples = bundle.samples
  if (!samples.length) throw new Error('导出文件里没有样本')

  /* 轴一：拿第一个样本做姿态扰动就够 —— 它测的是算法性质，不是这张脸 */
  const p0Drift = poseRobustness(samples[0], phase0Metrics)
  const p1Drift = poseRobustness(samples[0], phase1Metrics)
  const p0By = new Map(p0Drift.map((d) => [d.metric, d]))
  const p1By = new Map(p1Drift.map((d) => [d.metric, d]))

  const pairs: PairedDrift[] = PAIRS.flatMap(([a, b, name]) => {
    const x = p0By.get(a)
    const y = p1By.get(b)
    if (!x || !y) return []
    return [{ name, phase0: x, phase1: y, deltaRelative: round(y.relative - x.relative) }]
  })
  const paired1 = new Set(PAIRS.map(([, b]) => b))
  const phase1Only = p1Drift.filter((d) => !paired1.has(d.metric))

  /* 轴二、三：有分组才算 */
  const byShot = groupBy(samples, (s) => s.shotId)
  const multiFrame = [...byShot.values()].filter((g) => g.length > 1).flat()
  const bySubject = groupBy(samples, (s) => s.subjectId)
  const multiShot = [...bySubject.values()].filter((g) => g.length > 1)

  return {
    generatedAt: new Date().toISOString(),
    sampleCount: samples.length,
    subjectCount: bySubject.size,
    pose: { pairs, phase1Only },
    jitter: multiFrame.length
      ? { phase0: spreadsOf(multiFrame, phase0Metrics), phase1: spreadsOf(multiFrame, phase1Metrics) }
      : null,
    crossShot: multiShot.length
      ? {
          // 每个人各自算离散度后合并 —— 不能把不同人的值混在一起算
          phase0: mergePerGroup(multiShot, phase0Metrics),
          phase1: mergePerGroup(multiShot, phase1Metrics),
        }
      : null,
  }
}

/** 逐组算离散度，再对同一指标取各组的中位数 */
function mergePerGroup(
  groups: LandmarkSample[][],
  extract: (s: LandmarkSample) => Record<string, number>,
): Spread[] {
  const perMetric = new Map<string, Spread[]>()
  for (const g of groups) {
    for (const sp of spreadsOf(g, extract)) {
      const arr = perMetric.get(sp.metric) ?? []
      arr.push(sp)
      perMetric.set(sp.metric, arr)
    }
  }
  return [...perMetric].map(([metric, list]) => ({
    metric,
    n: list.reduce((s, x) => s + x.n, 0),
    median: round(median(list.map((x) => x.median))),
    mad: round(median(list.map((x) => x.mad))),
    maxDev: round(Math.max(...list.map((x) => x.maxDev))),
    relative: round(median(list.map((x) => x.relative))),
  }))
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const arr = m.get(k) ?? []
    arr.push(x)
    m.set(k, arr)
  }
  return m
}

function round(v: number, d = 4): number {
  const f = 10 ** d
  return Math.round(v * f) / f
}

/* ============================================================
   格式化
   ============================================================ */

/** 渲染成 Markdown，方便贴进 issue 或存档 */
export function formatReport(r: ValidationReport): string {
  const L: string[] = []
  L.push(`# Phase 0 / Phase 1 对比\n`)
  L.push(`样本 ${r.sampleCount} 个，来自 ${r.subjectCount} 位；生成于 ${r.generatedAt}\n`)

  L.push(`\n## 轴一 · 姿态鲁棒性（合成旋转，两代并排）\n`)
  L.push(`相对漂移 = 最大漂移 ÷ 基准值。**越小越稳**；Δ 为负说明 Phase 1 更稳。\n`)
  L.push(
    `> ⚠️ **这张表证明不了 Phase 1 在真实照片上更稳。**\n` +
      `> 合成旋转是在规范帧所假设的同一个空间里做的**刚体**旋转，帧能把它精确抵消，\n` +
      `> 于是 Phase 1 一列往往是 0.00% —— 那是恒等式，不是实测。\n` +
      `> 它真正能说明两件事：① Phase 0 对姿态有多敏感（那一列是实打实的）；\n` +
      `> ② 规范帧的基底构造没写错（写错了这里会留下残差）。\n` +
      `> 真实的鲁棒性要看轴二、轴三 —— 那里才有检测器噪声、真透视与自遮挡。\n`,
  )
  L.push(`| 指标 | Phase 0 | Phase 1 | Δ | 结论 |`)
  L.push(`|---|---|---|---|---|`)
  for (const p of r.pose.pairs) {
    const verdict = p.deltaRelative < -0.005 ? '✅ 更稳' : p.deltaRelative > 0.005 ? '⚠️ 更差' : '≈ 持平'
    L.push(`| ${p.name} | ${pct(p.phase0.relative)} | ${pct(p.phase1.relative)} | ${sign(p.deltaRelative)} | ${verdict} |`)
  }

  L.push(`\n### Phase 1 独有项（无对照，只看自身漂移）\n`)
  L.push(`| 指标 | 基准 | 最大漂移 | 相对 |`)
  L.push(`|---|---|---|---|`)
  for (const d of r.pose.phase1Only.filter((x) => FOCUS_IDS.includes(x.metric))) {
    L.push(`| ${d.metric} | ${d.base} | ${d.maxDrift} | ${pct(d.relative)} |`)
  }

  if (r.jitter) {
    L.push(`\n## 轴二 · 检测器抖动（同一张照片的多帧）\n`)
    L.push(spreadTable(r.jitter.phase0, r.jitter.phase1))
  } else {
    L.push(`\n## 轴二 · 检测器抖动\n\n_没有同一 shotId 的多帧样本，跳过。相机连拍路径才会产生。_`)
  }

  if (r.crossShot) {
    L.push(`\n## 轴三 · 跨拍摄一致性（同一个人的多张照片）\n`)
    L.push(spreadTable(r.crossShot.phase0, r.crossShot.phase1))
  } else {
    L.push(`\n## 轴三 · 跨拍摄一致性\n\n_没有同一 subjectId 的多张照片，跳过。这一条最接近真实使用，建议每人拍 3–5 张。_`)
  }

  return L.join('\n')
}

function spreadTable(p0: Spread[], p1: Spread[]): string {
  const a = new Map(p0.map((s) => [s.metric, s]))
  const b = new Map(p1.map((s) => [s.metric, s]))
  const L = [`| 指标 | Phase 0 相对离散 | Phase 1 相对离散 | Δ |`, `|---|---|---|---|`]
  for (const [k0, k1, name] of PAIRS) {
    const x = a.get(k0)
    const y = b.get(k1)
    if (!x || !y) continue
    L.push(`| ${name} | ${pct(x.relative)} | ${pct(y.relative)} | ${sign(y.relative - x.relative)} |`)
  }
  L.push('')
  L.push(`Phase 1 独有项：`)
  L.push(`| 指标 | 中位数 | MAD | 相对离散 |`)
  L.push(`|---|---|---|---|`)
  for (const s of p1.filter((s) => FOCUS_IDS.includes(s.metric) && !PAIRS.some(([, id]) => id === s.metric))) {
    L.push(`| ${s.metric} | ${s.median} | ${s.mad} | ${pct(s.relative)} |`)
  }
  return L.join('\n')
}

const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—')
const sign = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}pp` : '—')
