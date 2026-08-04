/**
 * 3D 特征模块的公共契约。
 *
 * 每个模块只管「量出数、说出依据」，不管分档口径与文案组织 ——
 * 那仍旧归 rules.ts / verdicts.ts。这样 Phase 2 换更强的形状回归器时，
 * 只有这一层要改，上面两层不动。
 */

import type { MethodPrior } from '@/core/band'
import type { Classic, FeatureCategory, FeatureUnit } from '@/core/types'
import type { FaceFrame } from '../normalize'

/**
 * 特征描述符。id / label / unit / category / method 这些不随人变的东西集中登记，
 * 计算模块只负责给出 value 与 evidence —— 避免同一个 id 在两处写出不同的单位。
 */
export interface FeatureSpec {
  id: string
  label: string
  category: FeatureCategory
  unit: FeatureUnit
  /** 方法固有可靠度，决定 confidence 的上限 */
  method: MethodPrior
  source: Classic | null
  /** 这一项在量什么，写给读代码的人，也写进文档 */
  describe: string
}

/** 模块算出来的一条结果。分档与释义在 rules 层完成 */
export interface Measurement {
  specId: string
  value: number
  /** 必须含具体数值，供 AI 引用与用户核对 */
  evidence: string
  /** 该项自身的额外折扣（如深度类受姿态影响），与 method 相乘 */
  factor?: number
  /** 覆盖默认 status（默认 measured；深度推断类给 inferred） */
  status?: 'measured' | 'inferred'
}

export interface FeatureModule {
  name: string
  specs: FeatureSpec[]
  compute(frame: FaceFrame): Measurement[]
}

/** 把 IOD 单位的长度写成人话 */
export const iodStr = (v: number): string => `${(v * 100).toFixed(1)}% IOD`
export const pctStr = (v: number): string => `${(v * 100).toFixed(1)}%`
export const round3 = (v: number): number => Math.round(v * 1000) / 1000
