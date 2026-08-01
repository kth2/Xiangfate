/**
 * 手相全链路。
 *
 * 与其他三类不同，这一条是**异步**的：掌纹提取要跑在 Worker 里。
 */

import { round } from '@/core/band'
import { toImageData } from '@/core/image'
import { assessQuality } from '@/core/quality'
import { computeScorecard } from '@/core/scorecard'
import {
  DEFAULT_FORBID_TOPICS,
  SCHEMA_VERSION,
  type AnalysisEnvelope,
  type PalmLineName,
  type ShotKind,
  type Subject,
} from '@/core/types'
import type { P2, P3 } from '@/core/geom'
import type { DetectResult } from '@/mediapipe/detect'
import { extractPalmLines } from '@/workers/palmline.client'
import { computeHandMetrics } from './metrics'
import { computeMounts } from './mounts'
import { normalizePalm } from './normalize'
import { classifyLines, measureCorrected, type LineMeasure } from './palmlines'
import { applyHandRules } from './rules'

export interface HandShot {
  detection: DetectResult
  bitmap: ImageBitmap
  side: 'left' | 'right'
}

export interface BuildHandInput {
  shots: HandShot[]
  subject?: Subject
  dominantHand?: 'left' | 'right' | null
  /** 用户在校正界面手动指认的掌线（标准画布坐标） */
  corrections?: Partial<Record<PalmLineName, P2[]>>
}

/** 中间产物，校正界面要用 */
export interface PalmAnalysis {
  side: 'left' | 'right'
  /** 归一化后的标准掌图，供校正界面显示 */
  normalized: ImageData
  lines: Map<PalmLineName, LineMeasure>
  /** 所有候选折线，校正界面里让用户点选 */
  candidates: { points: P2[]; length: number }[]
  response: Float32Array
  ms: number
}

/** 第一步：提取掌纹（异步，跑 Worker）。校正界面需要这一步的产物 */
export async function analyzePalm(shot: HandShot): Promise<PalmAnalysis> {
  const src = toImageData(shot.bitmap)
  const handedness = shot.detection.handedness?.label ?? (shot.side === 'left' ? 'Left' : 'Right')
  const { image } = normalizePalm(src, shot.detection.landmarks as P3[], handedness)

  const { lines, response, ms } = await extractPalmLines(image)
  const classified = classifyLines(lines, response)

  return {
    side: shot.side,
    normalized: image,
    lines: classified,
    candidates: lines.map((l) => ({ points: l.points, length: l.length })),
    response,
    ms,
  }
}

/** 第二步：把（可能经过校正的）分析结果拼成 envelope */
export function buildShouxiangEnvelope(
  input: BuildHandInput,
  analyses: PalmAnalysis[],
): AnalysisEnvelope {
  if (!analyses.length) throw new Error('没有可用的手掌分析结果')

  // 主手：优先惯用手，否则第一张
  const primaryIdx = Math.max(
    0,
    analyses.findIndex((a) => a.side === (input.dominantHand ?? analyses[0].side)),
  )
  const primary = analyses[primaryIdx]
  const primaryShot = input.shots[primaryIdx] ?? input.shots[0]

  // 应用用户校正
  const lines = new Map(primary.lines)
  for (const [name, pts] of Object.entries(input.corrections ?? {})) {
    if (!pts?.length) continue
    lines.set(name as PalmLineName, measureCorrected(name as PalmLineName, pts, primary.response))
  }

  const src = toImageData(primaryShot.bitmap)
  const xs = primaryShot.detection.landmarks.map((p) => p.x)
  const handWidthPx = (Math.max(...xs) - Math.min(...xs)) * primaryShot.bitmap.width

  const { quality, qualityFactor } = assessQuality({
    img: src,
    subjectWidthPx: handWidthPx,
    occlusion: [],
  })

  const m = computeHandMetrics(
    primaryShot.detection.landmarks as P3[],
    primaryShot.bitmap.width,
    primaryShot.bitmap.height,
  )
  const mounts = computeMounts(primary.normalized)

  const handsCaptured = [...new Set(analyses.map((a) => a.side))]
  const otherIdx = analyses.findIndex((_, i) => i !== primaryIdx)
  const otherScore =
    otherIdx >= 0 ? scoreOf(analyses[otherIdx].lines) : null

  const { features, unavailable, derived } = applyHandRules({
    m,
    lines,
    mounts,
    qualityFactor,
    detectorScore: primaryShot.detection.detectorScore,
    handedness: primaryShot.detection.handedness?.label ?? 'Right',
    dominantHand: input.dominantHand ?? null,
    otherHandScore: otherScore,
    handsCaptured,
  })

  const shots: ShotKind[] = analyses.map((a) => (a.side === 'left' ? 'left_palm' : 'right_palm'))

  return {
    schemaVersion: SCHEMA_VERSION,
    analysisType: 'shouxiang',
    analysisId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    locale: 'zh-CN',
    ...(input.subject ? { subject: input.subject } : {}),
    capture: { shots, quality },
    features,
    derived,
    raw: {
      normalizer: { type: 'PW', valuePx: 256 },
      metrics: {
        掌宽掌长比: round(m.palmAspect),
        中指掌长比: round(m.fingerPalmRatio),
        拇指掌长比: round(m.thumbRatio),
        食指无名指比: round(m.indexRingRatio),
        指节突出度: m.knuckleProminence,
        掌纹提取耗时毫秒: primary.ms,
        检出候选纹路数: primary.candidates.length,
        ...Object.fromEntries(
          [...lines.entries()].map(([n, L]) => [
            n,
            `长${L.lengthRatio} 深${L.depth} 续${L.continuity} 匹配${L.matchScore}`,
          ]),
        ),
      },
    },
    unavailable,
    scorecard: computeScorecard(features),
    policy: { disclaimerRequired: true, forbidTopics: [...DEFAULT_FORBID_TOPICS] },
  }
}

function scoreOf(lines: Map<PalmLineName, LineMeasure>): number {
  const main: PalmLineName[] = ['生命线', '智慧线', '感情线', '命运线']
  let sum = 0
  for (const n of main) {
    const L = lines.get(n)
    if (!L) continue
    sum += (Math.min(1.2, L.lengthRatio) / 1.2) * 0.4 + L.depth * 0.3 + L.continuity * 0.3
  }
  return +(sum / main.length).toFixed(3)
}

/** 有主线没测到就该进校正界面 */
export function needsCorrection(a: PalmAnalysis): PalmLineName[] {
  const main: PalmLineName[] = ['生命线', '智慧线', '感情线']
  return main.filter((n) => !a.lines.has(n))
}
