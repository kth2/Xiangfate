/**
 * 检测器的统一调用封装。把三种 MediaPipe 结果归一成同一个形状，
 * 供 Capture 页与后续的 metrics 模块使用。
 */

import type { DetectorKind } from '@/core/registry'
import { getDetector, type ProgressHandler } from './loader'

export interface Landmark {
  x: number
  y: number
  z: number
  visibility?: number
}

export interface DetectResult {
  detector: DetectorKind
  /** 归一化坐标 0–1（图像坐标系） */
  landmarks: Landmark[]
  /** 仅 pose：米制世界坐标，原点在髋中心。体相所有比例用它算 */
  worldLandmarks?: Landmark[]
  /** 仅 face：4×4 姿态矩阵，用于欧拉角质量门控 */
  transformMatrix?: number[]
  /** 仅 face：blendshape，用于表情检测（是否在笑/皱眉） */
  blendshapes?: { categoryName: string; score: number }[]
  /** 仅 hand：左右手 */
  handedness?: { label: 'Left' | 'Right'; score: number }
  /** 检测器自身的置信度，参与 confidence 计算 */
  detectorScore: number
}

export class NoSubjectError extends Error {
  readonly detector: DetectorKind

  constructor(detector: DetectorKind) {
    super(
      detector === 'face'
        ? '没找到人脸，换一张试试'
        : detector === 'hand'
          ? '没找到手掌，确认掌心正对镜头'
          : '没找到人像，确认全身在画面里',
    )
    this.name = 'NoSubjectError'
    this.detector = detector
  }
}

export async function detect(
  kind: DetectorKind,
  bitmap: ImageBitmap,
  onProgress?: ProgressHandler,
): Promise<DetectResult> {
  const det = await getDetector(kind, onProgress)

  if (kind === 'face') {
    const r = (det as import('@mediapipe/tasks-vision').FaceLandmarker).detect(bitmap)
    const lm = r.faceLandmarks?.[0]
    if (!lm?.length) throw new NoSubjectError('face')
    return {
      detector: 'face',
      landmarks: lm as Landmark[],
      transformMatrix: r.facialTransformationMatrixes?.[0]?.data
        ? Array.from(r.facialTransformationMatrixes[0].data)
        : undefined,
      blendshapes: r.faceBlendshapes?.[0]?.categories?.map((c) => ({
        categoryName: c.categoryName,
        score: c.score,
      })),
      // Face Landmarker 不返回整体置信度；检测到即视为可用，
      // 实际质量由 core/quality 的姿态角与清晰度门控负责
      detectorScore: 1,
    }
  }

  if (kind === 'hand') {
    const r = (det as import('@mediapipe/tasks-vision').HandLandmarker).detect(bitmap)
    const lm = r.landmarks?.[0]
    if (!lm?.length) throw new NoSubjectError('hand')
    const hd = r.handedness?.[0]?.[0]
    return {
      detector: 'hand',
      landmarks: lm as Landmark[],
      worldLandmarks: r.worldLandmarks?.[0] as Landmark[] | undefined,
      handedness: hd
        ? { label: hd.categoryName as 'Left' | 'Right', score: hd.score }
        : undefined,
      detectorScore: hd?.score ?? 0.8,
    }
  }

  const r = (det as import('@mediapipe/tasks-vision').PoseLandmarker).detect(bitmap)
  const lm = r.landmarks?.[0]
  if (!lm?.length) throw new NoSubjectError('pose')
  // Pose 无整体分数，用关键点可见性均值代替
  const vis = lm.map((p) => p.visibility ?? 0).filter((v) => v > 0)
  return {
    detector: 'pose',
    landmarks: lm as Landmark[],
    worldLandmarks: r.worldLandmarks?.[0] as Landmark[] | undefined,
    detectorScore: vis.length ? vis.reduce((a, b) => a + b, 0) / vis.length : 0.7,
  }
}

/**
 * 从 4×4 姿态矩阵分解欧拉角（度）。
 * MediaPipe 给的是列主序的 model→camera 变换。
 */
export function eulerFromMatrix(m: number[]): { yaw: number; pitch: number; roll: number } {
  // 列主序：m[col*4 + row]
  const r00 = m[0]
  const r10 = m[1]
  const r20 = m[2]
  const r21 = m[6]
  const r22 = m[10]

  const pitch = Math.atan2(-r20, Math.hypot(r21, r22))
  const yaw = Math.atan2(r10, r00)
  const roll = Math.atan2(r21, r22)

  const deg = (rad: number) => Math.round((rad * 180) / Math.PI * 10) / 10
  return { yaw: deg(yaw), pitch: deg(pitch), roll: deg(roll) }
}
