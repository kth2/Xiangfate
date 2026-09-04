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
import type { Matrix3 } from '@/cv/homography'
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
  /** 原图 → 标准画布 的单应矩阵。报告页要用它的逆把描线映回原照片 */
  H: Matrix3
  /** 左手先做过水平镜像；映回原图时要把这一步也撤掉 */
  mirrored: boolean
  /** 原照片尺寸，映回时用来撤镜像 */
  srcWidth: number
  srcHeight: number
  response: Float32Array
  ms: number
}

/** 第一步：提取掌纹（异步，跑 Worker）。校正界面需要这一步的产物 */
export async function analyzePalm(shot: HandShot): Promise<PalmAnalysis> {
  const src = toImageData(shot.bitmap)
  const handedness = shot.detection.handedness?.label ?? (shot.side === 'left' ? 'Left' : 'Right')
  const { image, H, mirrored } = normalizePalm(src, shot.detection.landmarks as P3[], handedness)

  const { lines, response, ms } = await extractPalmLines(image)
  const classified = classifyLines(lines, response)

  return {
    side: shot.side,
    normalized: image,
    lines: classified,
    candidates: lines.map((l) => ({ points: l.points, length: l.length })),
    H,
    mirrored,
    srcWidth: src.width,
    srcHeight: src.height,
    response,
    ms,
  }
}

/**
 * 把用户校正合并进自动识别的掌线，得到「这次实际采信的六条线」。
 *
 * 抽出来是因为报告页的掌图也要照着同一份结果描线 ——
 * 各算各的就会出现「图上画的是自动识别，文字说的是你确认过的」这种错位。
 */
export function resolvePalmLines(
  primary: PalmAnalysis,
  corrections?: Partial<Record<PalmLineName, P2[]>>,
): Map<PalmLineName, LineMeasure> {
  const lines = new Map(primary.lines)
  for (const [name, pts] of Object.entries(corrections ?? {})) {
    if (!pts?.length) continue
    lines.set(name as PalmLineName, measureCorrected(name as PalmLineName, pts, primary.response))
  }
  return lines
}

/**
 * 断语出自哪只手。
 *
 * 取**惯用手**（行事之手，相书所谓后天），这样报告正文讲的是「你现在的样子」。
 * 用户没答惯用手，或答的那只这次没拍到，就退回第一张 ——
 * 退回时 handContrast 会是 null，报告里如实说对照暂缺，不硬分先天后天。
 *
 * ⚠️ 这里原先写的是 `input.dominantHand ?? analyses[0].side`，
 * 而调用方传的 dominantHand 恰恰就是 `handShots[0].side` —— 于是「惯用手」
 * 永远等于第一张照片那只手。左撇子会被当成右利手处理，且毫无提示。
 * 抽成导出函数是为了让这条能被测试钉住，不必造位图。
 */
export function pickPrimaryIndex(
  analyses: { side: 'left' | 'right' }[],
  dominantHand: 'left' | 'right' | null,
): number {
  if (!dominantHand) return 0
  const i = analyses.findIndex((a) => a.side === dominantHand)
  return i >= 0 ? i : 0
}

/** 第二步：把（可能经过校正的）分析结果拼成 envelope */
export function buildShouxiangEnvelope(
  input: BuildHandInput,
  analyses: PalmAnalysis[],
): AnalysisEnvelope {
  if (!analyses.length) throw new Error('没有可用的手掌分析结果')

  const primaryIdx = pickPrimaryIndex(analyses, input.dominantHand ?? null)
  const primary = analyses[primaryIdx]
  const primaryShot = input.shots[primaryIdx] ?? input.shots[0]

  const lines = resolvePalmLines(primary, input.corrections)

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
  const { mounts } = computeMounts(primary.normalized)

  const handsCaptured = [...new Set(analyses.map((a) => a.side))]

  /**
   * 另一只手。两手都拍时，它的主线度量原样传进规则层做逐线对照 ——
   * 不再压成一个综合分去比大小。断语仍只出自惯用手那只。
   */
  const otherIdx = analyses.findIndex((_, i) => i !== primaryIdx)
  const other = otherIdx >= 0 ? analyses[otherIdx] : null

  const { features, unavailable, derived } = applyHandRules({
    m,
    lines,
    mounts,
    qualityFactor,
    detectorScore: primaryShot.detection.detectorScore,
    handedness: primaryShot.detection.handedness?.label ?? 'Right',
    dominantHand: input.dominantHand ?? null,
    otherHandLines: other ? other.lines : null,
    otherHandSide: other ? other.side : null,
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

/** 有主线没测到就该进校正界面 */
export function needsCorrection(a: PalmAnalysis): PalmLineName[] {
  const main: PalmLineName[] = ['生命线', '智慧线', '感情线']
  return main.filter((n) => !a.lines.has(n))
}
