/**
 * 骨相阈值。全部为工程初值，标 CALIBRATE，等真机采样后回归。
 * 部分与面相共享参考（颧宽、颌宽的 IOD 归一值来自规范脸与真人脸）。
 */

import type { BandSpec } from '@/core/band'

export const T = {
  /** 颧宽 ÷ IOD。规范脸 1.85 左右 */
  zygoWidth: { veryLo: 1.6, lo: 1.72, hi: 1.98, veryHi: 2.12 } satisfies BandSpec,
  /** 颧突出度 0–1 */
  zygoProminence: { veryLo: 0.25, lo: 0.38, hi: 0.66, veryHi: 0.8 } satisfies BandSpec,
  /** 左右颧高差 ÷ IOD，超过判为不对称 */
  zygoAsymTol: 0.02,
  /** 颧区轮廓锐度 0–1，高 = 骨露少肉 */
  zygoEdgeSharp: 0.55,
  zygoEdgeSoft: 0.35,

  /** 额宽 ÷ 颧宽 */
  foreheadRatio: { veryLo: 0.6, lo: 0.66, hi: 0.78, veryHi: 0.86 } satisfies BandSpec,
  /** 额高 ÷ IOD */
  foreheadHeight: { veryLo: 0.55, lo: 0.68, hi: 0.92, veryHi: 1.05 } satisfies BandSpec,
  /** 日月角对称容差 */
  dayMoonTol: 0.02,

  /** 颌宽 ÷ 颧宽 */
  jawRatio: { veryLo: 0.66, lo: 0.73, hi: 0.86, veryHi: 0.93 } satisfies BandSpec,
  jawSquare: 0.86,
  jawNarrow: 0.73,
  /** 下颌角（度），越小越方 */
  gonialSquare: 125,
  gonialSoft: 145,
  /** 下巴曲率半径 ÷ IOD */
  chinSharp: 0.35,
  chinRound: 0.55,

  /** 太阳穴宽 ÷ 颧宽 */
  templeRatio: { veryLo: 0.82, lo: 0.88, hi: 1.0, veryHi: 1.08 } satisfies BandSpec,

  /** 眉弓突出 0–1 */
  browRidge: { veryLo: 0.2, lo: 0.32, hi: 0.6, veryHi: 0.75 } satisfies BandSpec,

  /** 骨肉比。传统以「骨肉相称」为最佳 */
  boneFlesh: { boneHeavy: 0.6, fleshHeavy: 0.4 },

  /** 头指数 = 头宽 ÷ 头深。分头型 */
  cephalic: { long: 0.75, round: 0.85, flat: 0.95 },

  /** 体骨 */
  body: {
    shoulderBroad: 0.72,
    shoulderNarrow: 0.58,
    shoulderSlope: 4,
    pelvisWide: 0.78,
    pelvisNarrow: 0.66,
    spineUpright: 3,
    /** 腕宽 ÷ 前臂长，骨骼粗细 */
    wristThick: 0.42,
    wristThin: 0.32,
  },
} as const
