/**
 * 骨相全链路。
 * 输入：正面人脸（必需）+ 侧面人脸（必需，用于头型）+ 体照（可选）
 */

import { round } from '@/core/band'
import { toImageData } from '@/core/image'
import { assessQuality } from '@/core/quality'
import { computeScorecard } from '@/core/scorecard'
import {
  DEFAULT_FORBID_TOPICS,
  SCHEMA_VERSION,
  type AnalysisEnvelope,
  type OcclusionKind,
  type ShotKind,
  type Subject,
} from '@/core/types'
import type { P3 } from '@/core/geom'
import { eulerFromMatrix, type DetectResult } from '@/mediapipe/detect'
import { computeBoneMetrics } from './metrics'
import { applyBoneRules } from './rules'

export interface BuildBoneInput {
  front: { detection: DetectResult; bitmap: ImageBitmap }
  profile?: { detection: DetectResult; bitmap: ImageBitmap } | null
  body?: { detection: DetectResult; bitmap: ImageBitmap } | null
  subject?: Subject
}

export function buildGuxiangEnvelope({
  front,
  profile = null,
  body = null,
  subject,
}: BuildBoneInput): AnalysisEnvelope {
  const img = toImageData(front.bitmap)
  const lm = front.detection.landmarks as P3[]

  const xs = lm.map((p) => p.x)
  const faceWidthPx = (Math.max(...xs) - Math.min(...xs)) * front.bitmap.width
  const pose = front.detection.transformMatrix
    ? eulerFromMatrix(front.detection.transformMatrix)
    : undefined

  const occlusion: OcclusionKind[] = []
  if (!profile) occlusion.push('body_partial')

  const { quality, qualityFactor } = assessQuality({
    img,
    subjectWidthPx: faceWidthPx,
    pose,
    blendshapes: front.detection.blendshapes,
    occlusion: [],
  })

  const m = computeBoneMetrics({
    front: lm,
    frontImage: img,
    imgWidth: front.bitmap.width,
    imgHeight: front.bitmap.height,
    profile: profile
      ? {
          landmarks: profile.detection.landmarks as P3[],
          width: profile.bitmap.width,
          height: profile.bitmap.height,
        }
      : null,
    world: (body?.detection.worldLandmarks as P3[] | undefined) ?? null,
  })

  const { features, unavailable, derived } = applyBoneRules({
    m,
    qualityFactor,
    detectorScore: front.detection.detectorScore,
    hasProfile: Boolean(profile),
    hasBody: Boolean(body),
  })

  const shots: ShotKind[] = ['front']
  if (profile) shots.push('profile')
  if (body) shots.push('half_body')

  return {
    schemaVersion: SCHEMA_VERSION,
    analysisType: 'guxiang',
    analysisId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    locale: 'zh-CN',
    ...(subject ? { subject } : {}),
    capture: { shots, quality },
    features,
    derived,
    raw: {
      normalizer: { type: 'IOD', valuePx: round(m.zygoWidth, 3) },
      metrics: {
        颧宽: round(m.zygoWidth),
        颧突出: round(m.zygoProminence),
        颧对称差: round(m.zygoAsymmetry, 3),
        轮廓锐度: round(m.zygoEdge),
        额颧比: round(m.foreheadRatio),
        额高: round(m.foreheadHeight),
        日月角差: round(m.dayMoonAsym, 3),
        颌颧比: round(m.jawRatio),
        下颌角: round(m.gonialAngle, 1),
        下巴曲率: round(m.chinRadius),
        颞颧比: round(m.templeRatio),
        眉弓: round(m.browRidge),
        骨肉比: round(m.boneFleshRatio),
        颅指数: m.cephalicIndex,
        ...(m.body
          ? {
              肩躯比: round(m.body.shoulderRatio),
              髋肩比: round(m.body.pelvisRatio),
              脊椎倾角: round(m.body.spineTilt, 1),
              腕前臂比: round(m.body.wristRatio),
            }
          : {}),
      },
    },
    unavailable,
    scorecard: computeScorecard(features),
    policy: { disclaimerRequired: true, forbidTopics: [...DEFAULT_FORBID_TOPICS] },
  }
}
