/**
 * 体相阈值。
 *
 * ⚠️ 与面相不同，体相**没有官方的规范人体模型**可以拿来锚定，
 * 因此这里的数值全部是基于人体测量学常识的工程初值。
 * 全部标 CALIBRATE，等真机采样后回归。
 */

import type { BandSpec } from '@/core/band'

export const T = {
  /** 肩宽 ÷ 髋宽。CALIBRATE */
  shoulderHip: { veryLo: 1.12, lo: 1.2, hi: 1.45, veryHi: 1.6 } satisfies BandSpec,
  shoulderBroad: 1.45,
  shoulderNarrow: 1.2,

  /** 躯干长 ÷ 腿长。CALIBRATE */
  upperLower: { veryLo: 0.74, lo: 0.8, hi: 0.95, veryHi: 1.02 } satisfies BandSpec,
  upperLong: 0.95,
  lowerLong: 0.8,

  /** 颈长 ÷ 肩宽。CALIBRATE */
  neck: { veryLo: 0.18, lo: 0.23, hi: 0.33, veryHi: 0.4 } satisfies BandSpec,

  /** 臂展（单臂长）÷ 躯干长。CALIBRATE */
  armTorso: { veryLo: 0.9, lo: 1.0, hi: 1.2, veryHi: 1.32 } satisfies BandSpec,

  /** 体态角度（度） */
  posture: {
    /** 躯干轴与铅垂线夹角：≤ 此值为「直立挺拔」 */
    uprightTilt: 3,
    /** 超过此值为明显前倾/后仰 */
    leanTilt: 8,
    /** 肩线与水平线夹角：超过为「肩线不平」 */
    shoulderSlope: 4,
    /** 头部前倾：耳相对肩的水平偏移 ÷ 肩宽 */
    headForward: 0.12,
    /** 圆肩：肩 z 相对耳 z（世界坐标，米） */
    shoulderRoll: 0.04,
    /** 重心偏移：髋中点相对踝中点 ÷ 肩宽 */
    weightShift: 0.12,
  },

  /** 站姿开合：踝距 ÷ 肩宽 */
  /** 收窄至 ±15%（原 ±38.5%）。CALIBRATE */
  stance: { veryLo: 0.48, lo: 0.55, hi: 0.75, veryHi: 0.86 } satisfies BandSpec,
  /** 原值 0.9 / 0.4 是旧档位的 hi / lo，随 stance 收窄一起内移 */
  stanceWide: 0.75,
  stanceNarrow: 0.55,

  /** 体型三型的软分类判据。CALIBRATE */
  somatotype: {
    /** 内胚倾向：髋肩比高 + BMI 高 */
    endoHipShoulder: 0.78,
    endoBmi: 26,
    /** 中胚倾向：肩宽相对躯干长 */
    mesoShoulderTorso: 0.62,
    mesoBmi: 23,
    /** 外胚倾向：线性度 =（躯干+腿）÷ 肩宽 */
    ectoLinearity: 3.3,
    ectoBmi: 19,
    /** 单一型得分低于此判为「混合型」 */
    minScore: 0.5,
    /** 各型得分差都小于此判为「平衡型」 */
    balanceTol: 0.12,
  },

  /** 肌肤气色，同面相 */
  complexion: { ruddy: 0.5, pale: -0.8, uneven: 0.7, uniformGood: 0.85 },
} as const
