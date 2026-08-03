/**
 * 多帧聚合：把同一机位连拍的若干帧收敛成一份度量 + 一个稳定度。
 *
 * 为什么需要 ——
 * 单张照片就是一次机会：糊了、眨眼了、表情没收住、自动白平衡跳了一下，
 * 整份报告就建立在那一帧上。而且即使脸完全不动，MediaPipe 每帧吐出的
 * 关键点也不完全一样，逐帧算出来的比例会有肉眼看不见的抖动 ——
 * 落在分档判线附近时，这点抖动足以让同一个人两次拍出两套断语。
 *
 * 取中位数（而不是均值）是因为要防的是**离群帧**：一帧糊了、一帧眨眼了，
 * 均值会被拖走，中位数不会。
 *
 * 顺带白拿一个东西：帧间离散度本身就是诚实的置信度 ——
 * 「这个量重复测 5 次抖了多少」比任何基于画质的启发式都直接。
 *
 * ⚠️ 本文件属于 src/core，只放纯函数。
 */

import { median } from './geom'

/** 只允许数字与嵌套对象；数组与其他类型原样取第一帧 */
type Numericish = number | { [k: string]: unknown } | unknown

/**
 * 逐叶取中位数。
 * 所有样本必须是同一形状（同一个 metrics 计算函数的输出），否则以第一帧为准。
 */
export function medianOfSamples<T>(samples: T[]): T {
  if (samples.length === 0) throw new Error('medianOfSamples: 至少要一帧')
  if (samples.length === 1) return samples[0]
  return mergeMedian(samples as Numericish[]) as T
}

function mergeMedian(samples: Numericish[]): Numericish {
  const first = samples[0]

  if (typeof first === 'number') {
    const nums = samples.filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
    return nums.length ? median(nums) : first
  }

  // 数组、null、字符串、布尔：取第一帧，不做插值
  if (first === null || typeof first !== 'object' || Array.isArray(first)) return first

  const out: Record<string, unknown> = {}
  for (const key of Object.keys(first as Record<string, unknown>)) {
    out[key] = mergeMedian(
      samples.map((s) =>
        s && typeof s === 'object' ? (s as Record<string, unknown>)[key] : undefined,
      ),
    )
  }
  return out
}

export interface Stability {
  /** 参与聚合的帧数 */
  frames: number
  /** 各数值叶子的相对离散度中位数（MAD ÷ |中位数|），越小越稳 */
  dispersion: number
  /**
   * 置信度乘数（0.6–1）。帧间抖得厉害说明这一次采集本身不可靠，
   * 所有由几何量推出的论断都该相应弱化。
   */
  factor: number
}

/** 抖到这个相对离散度就认为不可靠 */
const DISPERSION_CEILING = 0.05

export function stabilityOf(samples: unknown[]): Stability {
  if (samples.length < 2) {
    return { frames: samples.length, dispersion: 0, factor: 1 }
  }

  const perLeaf: number[] = []
  collectDispersion(samples, perLeaf)

  const d = perLeaf.length ? median(perLeaf) : 0
  const factor = 1 - 0.4 * Math.min(1, d / DISPERSION_CEILING)

  return {
    frames: samples.length,
    dispersion: +d.toFixed(4),
    factor: +factor.toFixed(3),
  }
}

function collectDispersion(samples: unknown[], out: number[]): void {
  const first = samples[0]

  if (typeof first === 'number') {
    const nums = samples.filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
    if (nums.length < 2) return
    const m = median(nums)
    // MAD 而不是标准差 —— 同样是为了不被离群帧带偏
    const mad = median(nums.map((v) => Math.abs(v - m)))
    // 接近 0 的量（比如对称度偏差）用相对量会爆掉，改用绝对量兜底
    out.push(Math.abs(m) > 1e-6 ? mad / Math.abs(m) : mad)
    return
  }

  if (first === null || typeof first !== 'object' || Array.isArray(first)) return

  for (const key of Object.keys(first as Record<string, unknown>)) {
    collectDispersion(
      samples.map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>)[key] : undefined)),
      out,
    )
  }
}
