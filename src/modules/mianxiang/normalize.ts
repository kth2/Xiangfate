/**
 * 面部规范帧：把 MediaPipe 的图像坐标关键点，换成一套「与拍摄条件无关」的头部坐标。
 *
 * 为什么需要这一层 ——
 * 关键点是归一化图像坐标：x 除以图宽、y 除以图高、z 与 x 同尺度。
 * 直接量长度会同时混进三样与相理无关的东西：
 *   1. 画面宽高比（1080×1440 与 1080×1080 上同一张脸的比例不同）
 *   2. 拍摄距离（远近直接缩放一切）
 *   3. 头部姿态（转头 5° 就会让三停、五眼、颧骨突出度全部漂移）
 * 规范帧一次把三样都消掉：等比换算 → 头部基底 → 以 IOD 为单位。
 *
 * 关于姿态校正的取舍（重要，别改错方向）——
 * MediaPipe 的 facialTransformationMatrix 描述的是「规范脸网格 → 相机空间」的变换，
 * 而 landmarks 是弱透视下的图像空间点。两者坐标系并不严格一致，
 * 直接拿矩阵的旋转去乘图像空间的点，是把两套约定混在一起。
 * 因此这里的做法是：
 *   · **基底由关键点自己解出**（外眦连线定 x、额-颏连线定 y、叉乘定 z）。
 *     点云整体旋转时基底跟着旋转，所以这一步本身就是完整的姿态校正，且可被测试证伪。
 *   · **矩阵用来读欧拉角**，参与置信度折算：转得越偏，深度分量越不可靠。
 * 两者各司其职，谁都不越权。
 *
 * 深度约定：MediaPipe 的 z 越小越靠近镜头。帧内统一取 `depth = -z_frame`，
 * 于是**数值越大 = 越向前隆起**，与「隆」「凸」「朝拱」这些传统说法同向。
 */

import { eulerFromMatrix } from '@/mediapipe/detect'
import {
  centroid3,
  cross3,
  dot3,
  fitPlane,
  len3,
  norm3,
  orthogonalize,
  scale3,
  sub3,
  v3,
  type Plane,
  type V3,
} from '@/core/vec3'
import type { P3 } from '@/core/geom'
import {
  CHIN_BOTTOM,
  EYE,
  FACE_OVAL,
  FOREHEAD_TOP,
  IOD_PAIR,
  MIDLINE,
  MIRROR_PAIRS,
  NOSE_TIP,
} from './landmarks'

export interface FaceFrame {
  /**
   * 规范化后的关键点：原点在双外眦中点，x 指向被摄者左侧、y 向下、z 向后，
   * 单位为 IOD。索引与输入一一对应。
   */
  points: V3[]
  /** IOD 的像素长度，供「这张脸在画面里够不够大」一类判断 */
  iodPx: number
  /** 是否拿到了姿态矩阵（拿到才有 euler） */
  poseKnown: boolean
  euler: { yaw: number; pitch: number; roll: number } | null
  /**
   * 姿态折扣（0.5–1）。偏转越大，深度类测量越不可信 ——
   * 侧一点，鼻子的「隆起」里就掺进了透视缩短。
   */
  poseFactor: number
  /** 面平面：外周轮廓点拟合，五岳隆起以它为基准 */
  facePlane: Plane
  /** 中矢面：由镜像点对与中轴点拟合，对称性以它为基准 */
  midsagittal: Plane
}

/** 帧内的「向前隆起」量，正 = 朝向镜头 */
export const depthOf = (p: V3): number => -p.z

export interface FrameInput {
  landmarks: P3[]
  imgWidth: number
  imgHeight: number
  /** MediaPipe 的 facialTransformationMatrixes[0].data，列主序 4×4 */
  transformMatrix?: number[]
}

export function buildFaceFrame({
  landmarks,
  imgWidth,
  imgHeight,
  transformMatrix,
}: FrameInput): FaceFrame {
  /* ---------- 1. 等比空间 ---------- */
  // x 与 z 都按图宽归一化过，y 按图高；乘 aspect 把三轴拉回同一尺度
  const aspect = imgHeight > 0 ? imgWidth / imgHeight : 1
  const M = (i: number): V3 => {
    const p = landmarks[i]
    return v3(p.x * aspect, p.y, (p.z ?? 0) * aspect)
  }
  const metric = landmarks.map((_, i) => M(i))

  /* ---------- 2. 头部基底 ---------- */
  const outerL = metric[IOD_PAIR[1]] // IOD_PAIR = [右外眦, 左外眦]
  const outerR = metric[IOD_PAIR[0]]
  const xAxis = norm3(sub3(outerL, outerR))

  // y 取额顶→下巴，再对 x 正交化；两者都取不到时退回图像坐标轴
  const yRaw = sub3(metric[CHIN_BOTTOM], metric[FOREHEAD_TOP])
  let yAxis = norm3(orthogonalize(yRaw, xAxis))
  if (len3(yAxis) < 0.5) yAxis = norm3(orthogonalize(v3(0, 1, 0), xAxis))
  const zAxis = norm3(cross3(xAxis, yAxis))

  /* ---------- 3. 原点与尺度 ---------- */
  const origin = centroid3([outerL, outerR])
  const iod = len3(sub3(outerL, outerR))
  const scale = iod > 1e-9 ? 1 / iod : 1

  const points = metric.map((p) => {
    const d = sub3(p, origin)
    return v3(dot3(d, xAxis) * scale, dot3(d, yAxis) * scale, dot3(d, zAxis) * scale)
  })

  /* ---------- 4. 姿态 ---------- */
  const euler = transformMatrix?.length === 16 ? eulerFromMatrix(transformMatrix) : null
  const poseFactor = euler
    ? clamp(1 - (Math.abs(euler.yaw) / 45 + Math.abs(euler.pitch) / 45 + Math.abs(euler.roll) / 90) * 0.35, 0.5, 1)
    : 0.85 // 没有矩阵时不知道偏了多少，给一个保守的固定折扣

  /* ---------- 5. 两个参考平面 ---------- */
  // 面平面：外周轮廓。五官的隆起相对它来量，才不受整张脸前后平移影响。
  // 拟合出的法向朝哪一侧是任意的 —— 用鼻尖定向，统一成「向前为正」
  const faceFit = fitPlane(FACE_OVAL.map((i) => points[i]))
  const facePlane: Plane =
    dot3(sub3(points[NOSE_TIP], faceFit.point), faceFit.normal) < 0
      ? { normal: scale3(faceFit.normal, -1), point: faceFit.point }
      : faceFit

  // 中矢面：镜像点对的中点 + 中轴点。规范帧下法向应当很接近 x 轴
  const midPoints = [
    ...MIRROR_PAIRS.map(([l, r]) => centroid3([points[l], points[r]])),
    ...MIDLINE.map((i) => points[i]),
  ]
  const midFit = fitPlane(midPoints)
  // 拟合出的是「中矢面内」的平面，法向应取 x 方向；用镜像点对的连线方向定法向更稳
  const pairDir = norm3(
    centroid3(MIRROR_PAIRS.map(([l, r]) => sub3(points[l], points[r]))),
  )
  // 法向统一指向被摄者左侧（+x），保证左右残差的符号一致
  const midNormalRaw = len3(pairDir) > 0.5 ? pairDir : midFit.normal
  const midsagittal: Plane = {
    normal: midNormalRaw.x < 0 ? scale3(midNormalRaw, -1) : midNormalRaw,
    point: centroid3(midPoints),
  }

  return {
    points,
    iodPx: iod * imgHeight,
    poseKnown: euler !== null,
    euler,
    poseFactor: +poseFactor.toFixed(3),
    facePlane,
    midsagittal,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 眼宽（单眼）在帧内的长度，若干比例以它为分母 */
export function eyeWidth(frame: FaceFrame): number {
  const l = len3(sub3(frame.points[EYE.left.outer], frame.points[EYE.left.inner]))
  const r = len3(sub3(frame.points[EYE.right.outer], frame.points[EYE.right.inner]))
  return (l + r) / 2
}

/**
 * 一组点相对面平面的平均隆起（IOD 单位，正 = 向前）。
 * facePlane 的法向在 buildFaceFrame 里已用鼻尖定过向，这里直接投影即可。
 */
export function prominence(frame: FaceFrame, idx: readonly number[]): number {
  if (!idx.length) return 0
  let s = 0
  for (const i of idx) {
    s += dot3(sub3(frame.points[i], frame.facePlane.point), frame.facePlane.normal)
  }
  return s / idx.length
}
