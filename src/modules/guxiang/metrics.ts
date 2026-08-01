/**
 * 骨相度量。
 *
 * ⚠️ 骨相**没有可直接测量骨骼的端侧模型**。这是一个派生模块：
 * 从面部轮廓（正面 + 侧面）与体态关键点反推骨架特征。
 * 所有输出都属于「基于体表框架的推估」，不是测量 —— 这一点必须一路传到报告里。
 */

import { angleAt, dist, mean, sagittaRatio, type P2, type P3 } from '@/core/geom'
import {
  BROW,
  CHIN_BOTTOM,
  EYE,
  FOREHEAD_SIDE,
  FOREHEAD_TOP,
  GONION,
  IOD_PAIR,
  JAW_MID,
  NASAL_ROOT,
  TEMPLE,
  ZYGOMATIC,
} from '@/modules/mianxiang/landmarks'
import { POSE } from '@/modules/tixiang/landmarks'

export interface BoneMetrics {
  /** 颧宽 ÷ IOD */
  zygoWidth: number
  /** 颧点相对耳-鼻连线的深度突出（归一化 0–1） */
  zygoProminence: number
  /** 左右颧高度差 ÷ IOD */
  zygoAsymmetry: number
  /** 颧区轮廓边缘锐度 0–1，高 = 骨露少肉 */
  zygoEdge: number
  /** 额宽 ÷ 颧宽 */
  foreheadRatio: number
  /** 额高 ÷ IOD */
  foreheadHeight: number
  /** 左右额高差 ÷ IOD（日月角对称） */
  dayMoonAsym: number
  /** 颌宽 ÷ 颧宽 */
  jawRatio: number
  /** 下颌角（度），越小越方 */
  gonialAngle: number
  /** 下巴曲率半径 ÷ IOD */
  chinRadius: number
  /** 太阳穴宽 ÷ 颧宽 */
  templeRatio: number
  /** 眉弓突出代理 0–1 */
  browRidge: number

  /** 骨肉比 0–1，> 0.6 骨多肉少，< 0.4 骨少肉多 */
  boneFleshRatio: number

  /** 头指数 = 头宽 ÷ 头深，需侧面照；无侧面照为 null */
  cephalicIndex: number | null

  /** 体骨，需体照 */
  body: BoneBodyMetrics | null
}

export interface BoneBodyMetrics {
  /** 肩宽 ÷ 躯干长 */
  shoulderRatio: number
  /** 肩线倾角（度） */
  shoulderSlope: number
  /** 髋宽 ÷ 肩宽 */
  pelvisRatio: number
  /** 躯干轴倾角（度），脊椎挺直度代理 */
  spineTilt: number
  /** 腕宽 ÷ 前臂长，骨骼粗细代理 */
  wristRatio: number
}

export interface BoneInput {
  /** 正面人脸关键点（必需） */
  front: P3[]
  frontImage: ImageData
  imgWidth: number
  imgHeight: number
  /** 侧面人脸关键点（可选），用于头指数 */
  profile?: { landmarks: P3[]; width: number; height: number } | null
  /** 体照的世界坐标（可选） */
  world?: P3[] | null
}

export function computeBoneMetrics(input: BoneInput): BoneMetrics {
  const { front, frontImage, imgWidth, imgHeight } = input
  const aspect = imgWidth / imgHeight
  const Q = (i: number): P2 => ({ x: front[i].x * aspect, y: front[i].y })
  const Z = (i: number) => front[i].z

  const iod = dist(Q(IOD_PAIR[0]), Q(IOD_PAIR[1]))
  const N = (v: number) => v / iod

  const zygoWidth = dist(Q(ZYGOMATIC.left), Q(ZYGOMATIC.right))
  const jawWidth = dist(Q(GONION.left), Q(GONION.right))
  const foreheadWidth = dist(Q(FOREHEAD_SIDE.left), Q(FOREHEAD_SIDE.right))
  const templeWidth = dist(Q(TEMPLE.left), Q(TEMPLE.right))

  // 颧突出：颧点 z 相对鼻根与耳侧的中间基准
  const refZ = (Z(NASAL_ROOT) + (Z(TEMPLE.left) + Z(TEMPLE.right)) / 2) / 2
  const zygoZ = (Z(ZYGOMATIC.left) + Z(ZYGOMATIC.right)) / 2
  const zygoProminence = clamp01(((refZ - zygoZ) / iod + 0.1) / 0.35)

  const zygoAsymmetry = Math.abs(N(Q(ZYGOMATIC.left).y - Q(ZYGOMATIC.right).y))

  // 颧区轮廓锐度：沿颧-颌轮廓的灰度梯度
  const zygoEdge = edgeStrength(frontImage, [
    Q(ZYGOMATIC.right), Q(JAW_MID.right), Q(CHIN_BOTTOM), Q(JAW_MID.left), Q(ZYGOMATIC.left),
  ])

  const browLineY = mean([Q(BROW.left.innerTop).y, Q(BROW.right.innerTop).y])
  const foreheadHeight = N(Math.abs(browLineY - Q(FOREHEAD_TOP).y))
  const dayMoonAsym = Math.abs(
    N(Math.abs(Q(FOREHEAD_SIDE.left).y - browLineY) - Math.abs(Q(FOREHEAD_SIDE.right).y - browLineY)),
  )

  const gonialAngle = mean([
    angleAt(Q(ZYGOMATIC.right), Q(GONION.right), Q(CHIN_BOTTOM)),
    angleAt(Q(ZYGOMATIC.left), Q(GONION.left), Q(CHIN_BOTTOM)),
  ])

  const chinArc = [150, 149, 176, 148, 152, 377, 400, 378, 379].map(Q)
  const chinSag = sagittaRatio(chinArc)
  const chinChord = dist(chinArc[0], chinArc[chinArc.length - 1])
  const chinRadius = chinSag > 1e-6 ? N(chinChord / (8 * chinSag)) : 10

  // 眉弓：眉下缘到眼上睑的阴影梯度
  const browRidge = clamp01(
    edgeStrength(frontImage, [Q(BROW.right.outer), Q(BROW.right.inner), Q(EYE.right.upper)]) * 1.2,
  )

  /* ---------- 骨肉关系（本模块最可靠的一项）---------- */
  // 骨：颧宽 + 颌宽 + 颌角方正度
  const boneScore =
    norm(N(zygoWidth), 1.6, 2.2) * 0.4 +
    norm(N(jawWidth), 1.2, 1.9) * 0.3 +
    norm(140 - gonialAngle, 0, 40) * 0.3
  // 肉：轮廓平滑（锐度低）+ 下巴圆润 + 颏下厚度
  const fleshScore =
    (1 - zygoEdge) * 0.45 +
    norm(chinRadius, 0.25, 0.7) * 0.3 +
    norm(N(jawWidth) / N(zygoWidth), 0.7, 0.95) * 0.25
  const boneFleshRatio = clamp01(boneScore / Math.max(1e-6, boneScore + fleshScore))

  /* ---------- 头指数（需侧面照）---------- */
  let cephalicIndex: number | null = null
  if (input.profile) {
    const p = input.profile
    const pa = p.width / p.height
    const PQ = (i: number): P2 => ({ x: p.landmarks[i].x * pa, y: p.landmarks[i].y })
    const piod = dist(PQ(IOD_PAIR[0]), PQ(IOD_PAIR[1]))
    // 侧面照上，网格 x 跨度近似头部前后径
    const xs = p.landmarks.map((q) => q.x * pa)
    const headDepth = Math.max(...xs) - Math.min(...xs)
    // 正面照的头宽用最宽处
    const headWidth = dist(Q(FOREHEAD_SIDE.left), Q(FOREHEAD_SIDE.right))
    if (piod > 1e-6 && headDepth > 1e-6) {
      // 两张照片各自用自己的 IOD 归一，再相比
      cephalicIndex = +(headWidth / iod / (headDepth / piod)).toFixed(3)
    }
  }

  /* ---------- 体骨（需体照）---------- */
  let body: BoneBodyMetrics | null = null
  if (input.world?.length) {
    const W = input.world
    const d3 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    const shoulderW = d3(W[POSE.shoulderL], W[POSE.shoulderR])
    const hipW = d3(W[POSE.hipL], W[POSE.hipR])
    const shoulderMid = {
      x: (W[POSE.shoulderL].x + W[POSE.shoulderR].x) / 2,
      y: (W[POSE.shoulderL].y + W[POSE.shoulderR].y) / 2,
      z: (W[POSE.shoulderL].z + W[POSE.shoulderR].z) / 2,
    }
    const hipMid = {
      x: (W[POSE.hipL].x + W[POSE.hipR].x) / 2,
      y: (W[POSE.hipL].y + W[POSE.hipR].y) / 2,
      z: (W[POSE.hipL].z + W[POSE.hipR].z) / 2,
    }
    const torso = d3(shoulderMid, hipMid)
    const forearm = mean([
      d3(W[POSE.elbowL], W[POSE.wristL]),
      d3(W[POSE.elbowR], W[POSE.wristR]),
    ])
    // 腕宽用拇指-小指根的跨度近似
    const wristW = mean([
      d3(W[POSE.thumbL], W[POSE.pinkyL]),
      d3(W[POSE.thumbR], W[POSE.pinkyR]),
    ])

    body = {
      shoulderRatio: torso > 1e-6 ? shoulderW / torso : 0,
      shoulderSlope:
        (Math.atan2(
          Math.abs(W[POSE.shoulderL].y - W[POSE.shoulderR].y),
          Math.hypot(
            W[POSE.shoulderL].x - W[POSE.shoulderR].x,
            W[POSE.shoulderL].z - W[POSE.shoulderR].z,
          ),
        ) *
          180) /
        Math.PI,
      pelvisRatio: shoulderW > 1e-6 ? hipW / shoulderW : 0,
      spineTilt:
        (Math.atan2(
          Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.z - hipMid.z),
          Math.abs(shoulderMid.y - hipMid.y),
        ) *
          180) /
        Math.PI,
      wristRatio: forearm > 1e-6 ? wristW / forearm : 0,
    }
  }

  return {
    zygoWidth: N(zygoWidth),
    zygoProminence,
    zygoAsymmetry,
    zygoEdge,
    foreheadRatio: zygoWidth > 1e-6 ? foreheadWidth / zygoWidth : 0,
    foreheadHeight,
    dayMoonAsym,
    jawRatio: zygoWidth > 1e-6 ? jawWidth / zygoWidth : 0,
    gonialAngle,
    chinRadius,
    templeRatio: zygoWidth > 1e-6 ? templeWidth / zygoWidth : 0,
    browRidge,
    boneFleshRatio,
    cephalicIndex,
    body,
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function norm(v: number, lo: number, hi: number): number {
  return clamp01((v - lo) / Math.max(1e-6, hi - lo))
}

/**
 * 沿折线采样灰度梯度强度，归一化到 0–1。
 * 轮廓越锐（骨感），梯度越大。
 */
function edgeStrength(img: ImageData, path: P2[]): number {
  const { width, height, data } = img
  const grayAt = (x: number, y: number): number | null => {
    const px = Math.round(x * width)
    const py = Math.round(y * height)
    if (px < 1 || py < 1 || px >= width - 1 || py >= height - 1) return null
    const i = (py * width + px) * 4
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  const grads: number[] = []
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k]
    const b = path[k + 1]
    const steps = 20
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = a.x + (b.x - a.x) * t
      const y = a.y + (b.y - a.y) * t
      // 法向方向的一阶差分
      const dx = b.y - a.y
      const dy = -(b.x - a.x)
      const len = Math.hypot(dx, dy) || 1
      const off = 0.01
      const g1 = grayAt(x + (dx / len) * off, y + (dy / len) * off)
      const g2 = grayAt(x - (dx / len) * off, y - (dy / len) * off)
      if (g1 !== null && g2 !== null) grads.push(Math.abs(g1 - g2))
    }
  }
  if (grads.length < 5) return 0.5
  // 经验范围：梯度 0–60 映射到 0–1
  return clamp01(mean(grads) / 60)
}
