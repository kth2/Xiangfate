/**
 * 3D 特征注册表与组装入口。
 *
 * 所有模块在这里登记。注册表是**单一事实来源**：
 * id、label、单位、方法可靠度只在 spec 里写一次，
 * 计算模块只给 value 与 evidence —— 于是不可能出现同一个 id 在两处单位不一致。
 *
 * 测试会校验：id 全局唯一、每条 Measurement 都能找到 spec、
 * 每个 spec 都被某个模块实际产出。
 */

import { computeConfidence, MIN_CONFIDENCE, round, type DraftFeature } from '@/core/band'
import type { FeatureItem } from '@/core/types'
import { buildFaceFrame, type FaceFrame, type FrameInput } from '../normalize'
import { boneFleshModule } from './boneFlesh'
import { mingGongModule } from './mingGong'
import { noseModule } from './nose'
import { allPalaceStats, palacesModule, type PalaceStat } from './palaces'
import { symmetry3dModule } from './symmetry3d'
import { threeCourtsModule } from './threeCourts'
import { wuYueModule } from './wuYue'
import type { FeatureModule, FeatureSpec } from './types'

export const FEATURE_MODULES: FeatureModule[] = [
  threeCourtsModule,
  noseModule,
  mingGongModule,
  wuYueModule,
  palacesModule,
  symmetry3dModule,
  boneFleshModule,
]

/** id → spec。模块加载时建一次 */
export const FEATURE_REGISTRY: ReadonlyMap<string, FeatureSpec> = new Map(
  FEATURE_MODULES.flatMap((m) => m.specs.map((s) => [s.id, s] as const)),
)

export interface Face3DResult {
  frame: FaceFrame
  /** 已按 spec 组装好的草稿特征，交给 partitionByConfidence 分流 */
  features: DraftFeature[]
  palaceStats: PalaceStat[]
  /** 写进 raw 的诊断信息 */
  diagnostics: Record<string, number | string | boolean>
}

export interface Face3DOptions extends FrameInput {
  /** 照片质量门控得分，参与 confidence */
  qualityFactor: number
  /** MediaPipe 自身的检测置信度 */
  detectorScore: number
}

export function computeFace3DFeatures(opts: Face3DOptions): Face3DResult {
  const frame = buildFaceFrame(opts)
  const features: DraftFeature[] = []

  for (const mod of FEATURE_MODULES) {
    for (const m of mod.compute(frame)) {
      const spec = FEATURE_REGISTRY.get(m.specId)
      if (!spec) continue // 注册表兜底；测试会保证这行不会被走到

      const base = computeConfidence(opts.qualityFactor, opts.detectorScore, spec.method)
      const confidence = round(base * (m.factor ?? 1))

      features.push({
        id: spec.id,
        category: spec.category,
        label: spec.label,
        // 分档由 rules 层按各自阈值决定；3D 层只出数值
        band: 'categorical',
        value: round(m.value, 3),
        unit: spec.unit,
        status: m.status ?? 'measured',
        confidence,
        evidence: m.evidence,
        // 释义同样归 rules 层 —— 这里给一句中性的量纲说明，避免空字符串
        meaning: spec.describe,
        source: spec.source,
        lowConfidenceDetail: `${spec.label}依赖三维深度，本次姿态或画质不足以支撑（姿态折扣 ${frame.poseFactor}）`,
      })
    }
  }

  return {
    frame,
    features,
    palaceStats: allPalaceStats(frame),
    diagnostics: {
      IOD像素: round(frame.iodPx, 1),
      姿态已知: frame.poseKnown,
      姿态折扣: frame.poseFactor,
      ...(frame.euler
        ? { 偏航角: frame.euler.yaw, 俯仰角: frame.euler.pitch, 翻滚角: frame.euler.roll }
        : {}),
    },
  }
}

/** 供 UI / 调试：把注册表摊平成一张表 */
export function listFeatureSpecs(): FeatureSpec[] {
  return [...FEATURE_REGISTRY.values()]
}

/** 判断一条特征是否来自 3D 管线 —— 报告层要分开展示时用 */
export function is3DFeature(f: FeatureItem): boolean {
  return f.id.startsWith('face3d.')
}

export { MIN_CONFIDENCE }
export type { FeatureSpec } from './types'
export type { PalaceStat } from './palaces'
