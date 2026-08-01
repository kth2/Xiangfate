/**
 * 照片质量门控。产出 `Quality` 对象与一个 0–1 的 qualityFactor，
 * 后者会乘进每条特征的 confidence（见 core/band.ts）。
 *
 * 原则：**从不拒图，只降权 + 提示**。
 * 能走到这一步，说明检测器已经认出了主体 —— 那比任何画质启发式都更能说明
 * 照片可用。真正无法使用的情况由检测失败（NoSubjectError）负责拦截。
 * 剩下的交给置信度机制兜底，让用户自己决定要不要重拍。
 */

import type { OcclusionKind, Quality } from './types'
import { detectColorCast, meanLuminanceLab } from './color'
import { sharpnessScore } from './image'
import { clamp01 } from './band'

export const THRESH = {
  /** 主体最小像素宽 */
  minSubjectPx: 400,
  /**
   * Laplacian 方差：低于此判为糊。
   *
   * ⚠️ 这个数是被真实照片纠正过的。初稿照搬了网上流传的「>100 为清晰」，
   * 结果拿 MediaPipe 官方测试人脸（600×600，478 点全部检出、姿态几乎为零）
   * 实测只有 **10.3** —— 初稿的门槛会把一张完美可用的照片判成废片。
   * 差异来自核（4 邻域 vs 8 邻域）、分辨率与题材（人像皮肤本就平滑）。
   * 现按实测量级重设，并且只降权、不拒绝。CALIBRATE
   */
  blurry: 6,
  /** 主体区域平均 L* 的可接受区间 */
  dimL: 35,
  harshL: 85,
  /** 面部姿态角上限（度） */
  yaw: 15,
  pitch: 12,
  roll: 10,
  /** 表情：blendshape 分数上限 */
  smile: 0.3,
  browDown: 0.3,
} as const

export interface QualityInput {
  img: ImageData
  /** 主体（脸/手/人）在图像中的像素宽 */
  subjectWidthPx: number
  /** 面部欧拉角，仅面相/骨相有 */
  pose?: { yaw: number; pitch: number; roll: number }
  /** face blendshapes，用于表情检测 */
  blendshapes?: { categoryName: string; score: number }[]
  /** 检测到的遮挡 */
  occlusion?: OcclusionKind[]
}

export interface QualityResult {
  quality: Quality
  /** 乘进 confidence 的总因子 */
  qualityFactor: number
  /** 气色专用因子（对光照更敏感），色偏时为 0 */
  complexionFactor: number
}

export function assessQuality(input: QualityInput): QualityResult {
  const { img, subjectWidthPx, pose, blendshapes, occlusion = [] } = input
  const issues: string[] = []
  let factor = 1

  /* ---- 清晰度 ---- */
  // 只降权，不拒绝。走到这一步说明检测器已经认出了主体 ——
  // 那是比任何清晰度启发式都强的可用性证据，此时再拒图就是自作聪明。
  const sharp = sharpnessScore(img)
  let sharpness: Quality['sharpness'] = 'ok'
  if (sharp < THRESH.blurry) {
    sharpness = 'blurry'
    factor *= 0.75
    issues.push('照片偏糊，纹路与轮廓类特征的可信度下降')
  }

  /* ---- 分辨率 ---- */
  let resolution: Quality['resolution'] = 'ok'
  if (subjectWidthPx < THRESH.minSubjectPx) {
    resolution = 'low'
    factor *= 0.8
    issues.push(`主体在画面中偏小（${Math.round(subjectWidthPx)}px），建议靠近一些重拍`)
  }

  /* ---- 光照 ---- */
  const L = meanLuminanceLab(img)
  const cast = detectColorCast(img)
  let lighting: Quality['lighting'] = 'ok'
  let complexionFactor = 1

  if (cast.cast) {
    lighting = 'color_cast'
    complexionFactor = 0
    issues.push('画面整体偏色，气色一项本次不作判断')
  } else if (L < THRESH.dimL) {
    lighting = 'dim'
    factor *= 0.85
    complexionFactor = 0.4
    issues.push('光线偏暗，气色与轮廓判断的可信度下降')
  } else if (L > THRESH.harshL) {
    lighting = 'harsh'
    factor *= 0.85
    complexionFactor = 0.4
    issues.push('光线过强，面部有过曝，部分细节丢失')
  }

  /* ---- 姿态（仅面相/骨相）---- */
  if (pose) {
    const over = (v: number, lim: number) => Math.max(0, Math.abs(v) - lim)
    const excess = over(pose.yaw, THRESH.yaw) + over(pose.pitch, THRESH.pitch) + over(pose.roll, THRESH.roll)
    if (excess > 0) {
      // 每超 1 度扣 2%，最多扣到 0.5
      factor *= Math.max(0.5, 1 - excess * 0.02)
      const parts: string[] = []
      if (Math.abs(pose.yaw) > THRESH.yaw) parts.push(`左右偏转 ${Math.abs(pose.yaw).toFixed(0)}°`)
      if (Math.abs(pose.pitch) > THRESH.pitch) parts.push(`俯仰 ${Math.abs(pose.pitch).toFixed(0)}°`)
      if (Math.abs(pose.roll) > THRESH.roll) parts.push(`侧倾 ${Math.abs(pose.roll).toFixed(0)}°`)
      issues.push(`头部不够端正（${parts.join('、')}），左右对称与比例测量会有偏差`)
    }
  }

  /* ---- 表情 ---- */
  if (blendshapes?.length) {
    const score = (name: string) =>
      blendshapes.find((b) => b.categoryName === name)?.score ?? 0
    const smile = Math.max(score('mouthSmileLeft'), score('mouthSmileRight'))
    const brow = Math.max(score('browDownLeft'), score('browDownRight'))
    if (smile > THRESH.smile) {
      factor *= 0.9
      issues.push('在笑，口角与法令的判断会偏乐观，建议表情放松后重拍')
    }
    if (brow > THRESH.browDown) {
      factor *= 0.92
      issues.push('眉头压低，眉眼相关判断会有偏差')
    }
  }

  /* ---- 遮挡 ---- */
  const OCCLUSION_MSG: Record<OcclusionKind, string> = {
    hair_covers_forehead: '额头被头发遮挡，上停与官禄宫的可信度下降',
    hair_covers_ears: '耳朵被头发遮挡',
    glasses: '戴着眼镜，眼部与卧蚕判断受影响',
    mask: '面部有遮挡物',
    hand_partial: '手掌未完整入镜',
    body_partial: '身体未完整入镜',
    loose_clothing: '衣着宽松，体态判断受影响',
  }
  for (const o of occlusion) {
    factor *= 0.85
    issues.push(OCCLUSION_MSG[o])
  }

  factor = clamp01(factor)

  return {
    quality: {
      score: +factor.toFixed(2),
      resolution,
      lighting,
      sharpness,
      ...(pose ? { pose } : {}),
      occlusion,
      issues,
    },
    qualityFactor: factor,
    complexionFactor: clamp01(factor * complexionFactor),
  }
}
