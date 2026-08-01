/**
 * 体相几何度量。
 *
 * 一律用 worldLandmarks（米制，原点在髋中心）算比例 —— 与相机距离和焦段无关。
 * 图像坐标只在两处用：判断关键点是否在画面内、气色像素采样。
 */

import { dist, dist3, mean, type P3 } from '@/core/geom'
import { LOWER_BODY, POSE, UPPER_BODY } from './landmarks'

export interface BodyMetrics {
  /** 是否拍到下半身 —— 没拍到则腿部与重心相关项全部不可用 */
  hasLowerBody: boolean
  shoulderWidth: number
  hipWidth: number
  shoulderHipRatio: number
  torsoLen: number
  legLen: number | null
  upperLowerRatio: number | null
  armLen: number
  armTorsoRatio: number
  neckLen: number
  neckRatio: number
  /** 腕相对大腿中点的位置：0 = 正好垂到大腿中部，正 = 更低 */
  armReach: number | null
  /** 线性度 =（躯干 + 腿）÷ 肩宽，外胚型判据 */
  linearity: number | null
  posture: PostureMetrics
}

export interface PostureMetrics {
  /** 躯干轴与铅垂线夹角（度） */
  trunkTilt: number
  /** 正 = 前倾，负 = 后仰 */
  trunkTiltSigned: number
  /** 肩线与水平线夹角（度） */
  shoulderSlope: number
  /** 头部前倾量 ÷ 肩宽 */
  headForward: number
  /** 圆肩代理：肩 z 相对耳 z（米） */
  shoulderRoll: number
  /** 重心偏移 ÷ 肩宽 */
  weightShift: number | null
  /** 踝距 ÷ 肩宽 */
  stanceWidth: number | null
}

const midOf = (a: P3, b: P3): P3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })

/**
 * @param world worldLandmarks（米制）
 * @param image 归一化图像坐标，仅用于可见性判断
 */
export function computeBodyMetrics(world: P3[], image: P3[]): BodyMetrics {
  const W = (i: number) => world[i]

  // 下半身是否入镜：图像坐标在 [0,1] 内且可见度够
  const visible = (i: number) => {
    const p = image[i] as P3 & { visibility?: number }
    return p && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 && (p.visibility ?? 1) > 0.5
  }
  const hasLowerBody = LOWER_BODY.every(visible)

  if (!UPPER_BODY.every((i) => world[i])) {
    throw new Error('上半身关键点不全，无法做体相分析')
  }

  const shoulderL = W(POSE.shoulderL)
  const shoulderR = W(POSE.shoulderR)
  const hipL = W(POSE.hipL)
  const hipR = W(POSE.hipR)

  const shoulderWidth = dist3(shoulderL, shoulderR)
  const hipWidth = dist3(hipL, hipR)
  const shoulderMid = midOf(shoulderL, shoulderR)
  const hipMid = midOf(hipL, hipR)
  const torsoLen = dist3(shoulderMid, hipMid)

  // 上臂 + 前臂分段和，比直线距离抗弯曲
  const armOf = (s: number, e: number, w: number) => dist3(W(s), W(e)) + dist3(W(e), W(w))
  const armLen = mean([
    armOf(POSE.shoulderL, POSE.elbowL, POSE.wristL),
    armOf(POSE.shoulderR, POSE.elbowR, POSE.wristR),
  ])

  const earMid = midOf(W(POSE.earL), W(POSE.earR))
  // 颈长取垂直分量：耳中点到肩中点的 y 差
  const neckLen = Math.abs(earMid.y - shoulderMid.y)

  let legLen: number | null = null
  let upperLowerRatio: number | null = null
  let armReach: number | null = null
  let linearity: number | null = null
  let weightShift: number | null = null
  let stanceWidth: number | null = null

  if (hasLowerBody) {
    const legOf = (h: number, k: number, a: number) => dist3(W(h), W(k)) + dist3(W(k), W(a))
    legLen = mean([
      legOf(POSE.hipL, POSE.kneeL, POSE.ankleL),
      legOf(POSE.hipR, POSE.kneeR, POSE.ankleR),
    ])
    upperLowerRatio = legLen > 1e-6 ? torsoLen / legLen : null
    linearity = shoulderWidth > 1e-6 ? (torsoLen + legLen) / shoulderWidth : null

    // 传统「手臂垂至大腿中部」：腕 y 相对髋膝中点 y
    const thighMidY = mean([
      (W(POSE.hipL).y + W(POSE.kneeL).y) / 2,
      (W(POSE.hipR).y + W(POSE.kneeR).y) / 2,
    ])
    const wristY = mean([W(POSE.wristL).y, W(POSE.wristR).y])
    const thighLen = mean([dist3(W(POSE.hipL), W(POSE.kneeL)), dist3(W(POSE.hipR), W(POSE.kneeR))])
    armReach = thighLen > 1e-6 ? (wristY - thighMidY) / thighLen : null

    const ankleMid = midOf(W(POSE.ankleL), W(POSE.ankleR))
    weightShift = shoulderWidth > 1e-6 ? Math.abs(hipMid.x - ankleMid.x) / shoulderWidth : null
    stanceWidth =
      shoulderWidth > 1e-6 ? dist3(W(POSE.ankleL), W(POSE.ankleR)) / shoulderWidth : null
  }

  /* ---------- 体态 ---------- */
  // 躯干轴相对铅垂线。world 坐标 y 向下为正
  const dx = shoulderMid.x - hipMid.x
  const dy = shoulderMid.y - hipMid.y
  const dz = shoulderMid.z - hipMid.z
  const trunkTilt = (Math.atan2(Math.hypot(dx, dz), Math.abs(dy)) * 180) / Math.PI
  // z 更小 = 更靠近镜头 = 前倾
  const trunkTiltSigned = (Math.atan2(-dz, Math.abs(dy)) * 180) / Math.PI

  const shoulderSlope =
    (Math.atan2(Math.abs(shoulderL.y - shoulderR.y), dist(shoulderL, shoulderR)) * 180) / Math.PI

  const headForward =
    shoulderWidth > 1e-6 ? Math.abs(earMid.z - shoulderMid.z) / shoulderWidth : 0
  const shoulderRoll = shoulderMid.z - earMid.z

  return {
    hasLowerBody,
    shoulderWidth,
    hipWidth,
    shoulderHipRatio: hipWidth > 1e-6 ? shoulderWidth / hipWidth : 0,
    torsoLen,
    legLen,
    upperLowerRatio,
    armLen,
    armTorsoRatio: torsoLen > 1e-6 ? armLen / torsoLen : 0,
    neckLen,
    neckRatio: shoulderWidth > 1e-6 ? neckLen / shoulderWidth : 0,
    armReach,
    linearity,
    posture: {
      trunkTilt,
      trunkTiltSigned,
      shoulderSlope,
      headForward,
      shoulderRoll,
      weightShift,
      stanceWidth,
    },
  }
}

/** BMI，仅在用户自评填了身高体重时可用。只喂给体型分类，不生成任何高矮胖瘦的评价 */
export function bmi(heightCm?: number | null, weightKg?: number | null): number | null {
  if (!heightCm || !weightKg || heightCm < 100 || heightCm > 250) return null
  const m = heightCm / 100
  return +(weightKg / (m * m)).toFixed(1)
}
