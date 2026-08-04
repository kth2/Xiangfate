/**
 * 面相全链路：关键点 + 图像 → AnalysisEnvelope。
 * 这是「确定性的归代码」那一半的终点 —— 出口就是发给 AI 的那份 JSON。
 */

import { partitionByConfidence, round } from '@/core/band'
import { analyzeComplexion } from '@/core/color'
import { assessQuality } from '@/core/quality'
import { computeScorecard } from '@/core/scorecard'
import {
  DEFAULT_FORBID_TOPICS,
  SCHEMA_VERSION,
  type AnalysisEnvelope,
  type OcclusionKind,
  type Subject,
} from '@/core/types'
import { medianOfSamples, stabilityOf } from '@/core/frames'
import { toImageData } from '@/core/image'
import { eulerFromMatrix, type DetectResult } from '@/mediapipe/detect'
import { COMPLEXION_REGIONS } from './landmarks'
import { computeFace3DFeatures } from './features'
import { detectMoles, measureEyeBag, measureNasolabial } from './marks'
import { browDensity, browTailDispersion, computeFaceMetrics } from './metrics'
import { applyFaceRules } from './rules'

export interface BuildInput {
  detection: DetectResult
  bitmap: ImageBitmap
  subject?: Subject
  /**
   * 连拍的其余帧（不含 detection 本身那一帧）。
   * 给了就逐帧算几何量再取中位数，并用帧间离散度折算置信度；
   * 不给则完全等同于单张照片的旧行为 —— 相册上传走的就是这条路。
   */
  extraDetections?: DetectResult[]
}

export function buildMianxiangEnvelope({
  detection,
  bitmap,
  subject,
  extraDetections,
}: BuildInput): AnalysisEnvelope {
  const { landmarks, blendshapes, transformMatrix, detectorScore } = detection
  const img = toImageData(bitmap)

  const pose = transformMatrix ? eulerFromMatrix(transformMatrix) : undefined

  // 人脸在画面中的像素宽 —— 质量门控要用
  const xs = landmarks.map((p) => p.x)
  const faceWidthPx = (Math.max(...xs) - Math.min(...xs)) * bitmap.width

  // 额头遮挡：网格顶端附近的暗度远高于额中 → 多半是头发压下来了
  const foreheadOccluded = detectForeheadOcclusion(img, landmarks)
  const occlusion: OcclusionKind[] = foreheadOccluded ? ['hair_covers_forehead'] : []

  const { quality, qualityFactor, complexionFactor } = assessQuality({
    img,
    subjectWidthPx: faceWidthPx,
    pose,
    blendshapes,
    occlusion,
  })

  /*
   * 连拍：逐帧算几何量后取中位数。
   * 像素类的活（气色、眉毛浓密、痣、卧蚕、法令）仍只在代表帧上跑一次 ——
   * 那几项吃的是同一张图的同一片像素，多跑几遍不会更准，只会更慢。
   */
  const frameSamples = [landmarks, ...(extraDetections ?? []).map((d) => d.landmarks)].map((lm) =>
    computeFaceMetrics(lm, bitmap.width, bitmap.height),
  )
  const m = medianOfSamples(frameSamples)
  const stability = stabilityOf(frameSamples)
  // 帧间抖得厉害 → 这一次采集本身就不可靠，几何论断一并弱化
  const effectiveScore = detectorScore * stability.factor

  const complexion =
    complexionFactor > 0
      ? analyzeComplexion(
          img,
          Object.fromEntries(
            Object.entries(COMPLEXION_REGIONS).map(([k, idxs]) => [
              k,
              idxs.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y })),
            ]),
          ),
        )
      : null

  const browPixels = {
    left: {
      density: browDensity(img, landmarks, 'left'),
      tailDispersion: browTailDispersion(img, landmarks, 'left'),
    },
    right: {
      density: browDensity(img, landmarks, 'right'),
      tailDispersion: browTailDispersion(img, landmarks, 'right'),
    },
  }

  // 痣、卧蚕、法令纹：三项都吃像素，画质太差时干脆不测（rules 会如实标 unavailable）
  const pixelsUsable = qualityFactor > 0.35
  const moles = pixelsUsable ? detectMoles(img, landmarks) : null
  const eyeBags = pixelsUsable
    ? { left: measureEyeBag(img, landmarks, 'left'), right: measureEyeBag(img, landmarks, 'right') }
    : null
  const nasolabial = pixelsUsable
    ? {
        left: measureNasolabial(img, landmarks, 'left'),
        right: measureNasolabial(img, landmarks, 'right'),
      }
    : null

  /*
   * 3D 特征管线（schema 2.0）。
   * 与既有的二维规则**并行**产出，不替换 —— 旧特征的 id、阈值、断语全部不动，
   * 因此这次升级对报告与历史记录都是纯增量。
   */
  const face3d = computeFace3DFeatures({
    landmarks,
    imgWidth: bitmap.width,
    imgHeight: bitmap.height,
    transformMatrix,
    qualityFactor,
    detectorScore: effectiveScore,
  })

  const { features, unavailable, derived } = applyFaceRules({
    m,
    qualityFactor,
    complexionFactor,
    detectorScore: effectiveScore,
    complexion,
    browPixels,
    foreheadOccluded,
    moles,
    eyeBags,
    nasolabial,
  })

  // 3D 项同样要过置信度门槛，走同一个分流入口
  const partitioned3d = partitionByConfidence(face3d.features)

  return {
    schemaVersion: SCHEMA_VERSION,
    analysisType: 'mianxiang',
    analysisId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    locale: 'zh-CN',
    ...(subject ? { subject } : {}),
    capture: { shots: ['front'], quality },
    features: [...features, ...partitioned3d.features],
    derived,
    raw: {
      normalizer: { type: 'IOD', valuePx: round(m.iodPx, 1) },
      metrics: {
        三停: `${round(m.threeCourts.upper, 3)} / ${round(m.threeCourts.middle, 3)} / ${round(m.threeCourts.lower, 3)}`,
        五眼: round(m.fiveEye),
        眼距: round(m.innerGap),
        眉长比: round((m.brow.left.lenRatio + m.brow.right.lenRatio) / 2),
        眼纵横比: round((m.eye.left.aspect + m.eye.right.aspect) / 2),
        外眦上扬角: round((m.eye.left.canthalTilt + m.eye.right.canthalTilt) / 2, 1),
        鼻长: round(m.nose.len),
        鼻翼宽: round(m.nose.alarWidth),
        鼻梁偏移: round(m.nose.bridgeDeviation, 3),
        口宽鼻翼比: round(m.mouth.widthOverAlar),
        口角上扬: round(m.mouth.cornerLift, 3),
        唇厚: round(m.mouth.lipThickness),
        人中长: round(m.mouth.philtrumLen),
        面宽高比: round(m.contour.fw),
        颌颧比: round(m.contour.jc),
        额颧比: round(m.contour.fc),
        下颌角: round(m.contour.gonialAngle, 1),
        对称度: m.symmetryScore,
        田宅: round(m.tianzhai),
        ...(eyeBags
          ? { 卧蚕隆起: round(bilat(eyeBags.left.ridge, eyeBags.right.ridge)) }
          : {}),
        ...(nasolabial
          ? {
              法令纹深: round(bilat(nasolabial.left.depth, nasolabial.right.depth)),
              法令连续性: round(bilat(nasolabial.left.continuity, nasolabial.right.continuity)),
            }
          : {}),
        ...(moles && !moles.failed ? { 检出痣数: moles.moles.length } : {}),
        ...face3d.diagnostics,
        ...(stability.frames > 1
          ? {
              连拍帧数: stability.frames,
              帧间离散度: stability.dispersion,
            }
          : {}),
      },
      ...(complexion
        ? {
            complexion: {
              相对红度: complexion.aRel,
              相对黄度: complexion.bRel,
              明度均匀度: complexion.uniformity,
              高光占比: complexion.gloss,
            },
          }
        : {}),
    },
    unavailable: [...unavailable, ...partitioned3d.unavailable],
    // 星级仍只由二维规则算 —— 3D 项还没有校准过的阈值，不该参与打分
    scorecard: computeScorecard(features),
    policy: { disclaimerRequired: true, forbidTopics: [...DEFAULT_FORBID_TOPICS] },
  }
}

const bilat = (l: number, r: number) => (l + r) / 2

/**
 * 额头遮挡检测：比较网格顶端带与额中带的亮度。
 * 头发压额时顶端明显更暗。阈值宽松 —— 误判的代价只是多一句提示。
 */
function detectForeheadOcclusion(
  img: ImageData,
  landmarks: { x: number; y: number }[],
): boolean {
  const top = landmarks[10]
  const glabella = landmarks[9]
  if (!top || !glabella) return false

  const bandLum = (yNorm: number) => {
    const y = Math.round(yNorm * img.height)
    if (y < 0 || y >= img.height) return null
    const x0 = Math.round(Math.max(0, (top.x - 0.06) * img.width))
    const x1 = Math.round(Math.min(img.width - 1, (top.x + 0.06) * img.width))
    let sum = 0
    let n = 0
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 4
      sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
      n++
    }
    return n ? sum / n : null
  }

  // 顶端稍往下一点，避开网格边界本身
  const topLum = bandLum(top.y + (glabella.y - top.y) * 0.15)
  const midLum = bandLum(top.y + (glabella.y - top.y) * 0.6)
  if (topLum === null || midLum === null) return false

  return topLum < midLum * 0.72
}
