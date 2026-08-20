/**
 * 手相阈值。工程初值，全部待真机校准。
 */

import type { BandSpec } from '@/core/band'

export const T = {
  /** 掌宽 ÷ 掌长。CALIBRATE */
  palmAspect: { veryLo: 0.66, lo: 0.72, hi: 0.84, veryHi: 0.92 } satisfies BandSpec,
  /** 中指长 ÷ 掌长 */
  fingerPalm: { veryLo: 0.78, lo: 0.85, hi: 0.98, veryHi: 1.06 } satisfies BandSpec,
  /** 拇指长 ÷ 掌长 */
  thumb: { veryLo: 0.48, lo: 0.54, hi: 0.66, veryHi: 0.74 } satisfies BandSpec,
  thumbStrong: 0.62,
  thumbShort: 0.52,
  /** 食指长 ÷ 无名指长 */
  indexRing: { veryLo: 0.9, lo: 0.94, hi: 1.02, veryHi: 1.07 } satisfies BandSpec,
  indexLong: 1.02,
  ringLong: 0.94,
  /** 指节突出度 0–1。收窄至 ±15%（原 ±26.4%）。CALIBRATE */
  knuckle: { veryLo: 0.32, lo: 0.37, hi: 0.50, veryHi: 0.58 } satisfies BandSpec,

  /** 手型分类判据 */
  handType: {
    squarePalm: 0.78,
    narrowPalm: 0.72,
    longFinger: 0.95,
    shortFinger: 0.85,
    /** 原值 0.55 是旧档位的 hi，随 knuckle 收窄一起下移到新的 hi */
    knuckleHigh: 0.5,
  },

  /** 掌线度量 */
  line: {
    /** 长度 ÷ 掌宽 */
    lifeLong: 1.0,
    lifeShort: 0.65,
    headLong: 0.85,
    headShort: 0.6,
    heartLong: 0.9,
    /** 深浅 0–1 */
    deep: 0.55,
    shallow: 0.35,
    /** 连续性 0–1，低于此为「断续」 */
    broken: 0.7,
    /** 曲率：直 vs 弯 */
    straight: 0.08,
    curved: 0.15,
  },

  /** 左右手对照：综合分差超过此值判为一侧更优 */
  handDiff: 0.1,
} as const
