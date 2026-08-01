/**
 * 体相全链路：Pose 关键点 + 图像 → AnalysisEnvelope。
 */

import { round } from '@/core/band'
import { analyzeComplexion } from '@/core/color'
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
import type { DetectResult } from '@/mediapipe/detect'
import type { P3 } from '@/core/geom'
import { SKIN_REGIONS } from './landmarks'
import { bmi, computeBodyMetrics } from './metrics'
import { applyBodyRules } from './rules'
import type { SurveyAnswers } from './survey'

export interface BuildBodyInput {
  detection: DetectResult
  bitmap: ImageBitmap
  subject?: Subject
  survey?: SurveyAnswers | null
  shotKind?: ShotKind
}

export function buildTixiangEnvelope({
  detection,
  bitmap,
  subject,
  survey = null,
  shotKind = 'full_body',
}: BuildBodyInput): AnalysisEnvelope {
  const { landmarks, worldLandmarks, detectorScore } = detection
  if (!worldLandmarks?.length) {
    throw new Error('本次没有拿到世界坐标，体相比例算不了，换一张照片试试')
  }

  const img = toImageData(bitmap)

  const xs = landmarks.map((p) => p.x)
  const subjectWidthPx = (Math.max(...xs) - Math.min(...xs)) * bitmap.width

  const m = computeBodyMetrics(worldLandmarks as P3[], landmarks as P3[])

  const occlusion: OcclusionKind[] = m.hasLowerBody ? [] : ['body_partial']

  const { quality, qualityFactor, complexionFactor } = assessQuality({
    img,
    subjectWidthPx,
    occlusion,
  })

  const complexion =
    complexionFactor > 0
      ? analyzeComplexion(
          img,
          Object.fromEntries(
            Object.entries(SKIN_REGIONS).map(([k, idxs]) => [
              k,
              idxs.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y })),
            ]),
          ),
        )
      : null

  const bmiValue = bmi(survey?.heightCm, survey?.weightKg)

  const { features, unavailable, derived } = applyBodyRules({
    m,
    qualityFactor,
    complexionFactor,
    detectorScore,
    complexion,
    survey,
    bmiValue,
    segmentationUsed: false,
  })

  return {
    schemaVersion: SCHEMA_VERSION,
    analysisType: 'tixiang',
    analysisId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    locale: 'zh-CN',
    ...(subject ? { subject } : {}),
    capture: { shots: [m.hasLowerBody ? shotKind : 'half_body'], quality },
    features,
    derived,
    raw: {
      normalizer: { type: 'world', valuePx: round(m.shoulderWidth, 4) },
      metrics: {
        肩宽米: round(m.shoulderWidth, 3),
        髋宽米: round(m.hipWidth, 3),
        肩髋比: round(m.shoulderHipRatio),
        躯干长米: round(m.torsoLen, 3),
        腿长米: m.legLen === null ? null : round(m.legLen, 3),
        上下身比: m.upperLowerRatio === null ? null : round(m.upperLowerRatio),
        臂躯比: round(m.armTorsoRatio),
        颈肩比: round(m.neckRatio),
        线性度: m.linearity === null ? null : round(m.linearity),
        躯干倾角: round(m.posture.trunkTilt, 1),
        肩线倾角: round(m.posture.shoulderSlope, 1),
        头前倾: round(m.posture.headForward),
        重心偏移: m.posture.weightShift === null ? null : round(m.posture.weightShift),
        站姿开合: m.posture.stanceWidth === null ? null : round(m.posture.stanceWidth),
        ...(bmiValue !== null ? { BMI: bmiValue } : {}),
      },
      ...(complexion
        ? { complexion: { 相对红度: complexion.aRel, 明度均匀度: complexion.uniformity } }
        : {}),
    },
    unavailable,
    scorecard: computeScorecard(features),
    policy: { disclaimerRequired: true, forbidTopics: [...DEFAULT_FORBID_TOPICS] },
  }
}
