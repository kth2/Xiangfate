/**
 * 面相几何度量。纯计算，输入关键点，输出数值。
 * 不做任何解释与分档 —— 那是 rules.ts 的事。
 *
 * 所有长度都除以 IOD（双眼外眦距离），因此与拍摄距离无关。
 */

import {
  angleAt,
  elevationDeg,
  dist,
  mean,
  median,
  principalAxis,
  reflectAcrossLine,
  sagittaRatio,
  signedDistToLine,
  signedSagittaRatio,
  stdev,
  type P2,
  type P3,
} from '@/core/geom'
import {
  BROW,
  CHIN_BOTTOM,
  EYE,
  FACE_OVAL,
  FACE_WIDEST,
  FOREHEAD_SIDE,
  FOREHEAD_TOP,
  GONION,
  IRIS,
  IOD_PAIR,
  MIRROR_PAIRS,
  MOUTH,
  NOSE,
  NASAL_ROOT,
  PHILTRUM,
  SUBNASALE,
  TEMPLE,
  THREE_COURTS,
  ZYGOMATIC,
} from './landmarks'
import { HAIRLINE_FACTOR } from './thresholds'

export type Side = 'left' | 'right'

export interface FaceMetrics {
  iodPx: number
  threeCourts: { upper: number; middle: number; lower: number; maxDiff: number }
  fiveEye: number
  innerGap: number
  brow: Record<Side, BrowMetrics>
  eye: Record<Side, EyeMetrics>
  nose: NoseMetrics
  mouth: MouthMetrics
  contour: ContourMetrics
  symmetryScore: number
  /** 眉眼间距 ÷ 单眼宽（田宅宫） */
  tianzhai: number
}

export interface BrowMetrics {
  lenRatio: number
  curvature: number
  signedCurvature: number
  /** 内端到外端的倾角（度），正 = 眉尾上扬 */
  tilt: number
  /** 眉头 y 相对眉尾 y（归一化）：正 = 眉头高于眉尾（八字眉） */
  innerHigher: number
  gapRatio: number
}

export interface EyeMetrics {
  aspect: number
  width: number
  canthalTilt: number
  /** 虹膜可见度：可见高度 ÷ 虹膜直径 */
  openness: number
  /** 虹膜上/下方巩膜暴露 */
  scleraUpper: number
  scleraLower: number
}

export interface NoseMetrics {
  len: number
  alarWidth: number
  aspect: number
  bridgeDeviation: number
  bridgeHeight: number
  tipFullness: number
  /** 鼻尖相对鼻梁下段的 y 偏移，正 = 下垂（鹰钩） */
  tipDroop: number
}

export interface MouthMetrics {
  width: number
  widthOverAlar: number
  lipThickness: number
  upperLower: number
  cornerLift: number
  philtrumLen: number
}

export interface ContourMetrics {
  faceWidth: number
  faceHeight: number
  /** 面宽高比 */
  fw: number
  zygoWidth: number
  jawWidth: number
  foreheadWidth: number
  templeWidth: number
  /** 颌颧比 */
  jc: number
  /** 额颧比 */
  fc: number
  /** 下颌角（度） */
  gonialAngle: number
  /** 下巴轮廓曲率半径 ÷ IOD，小 = 尖/方，大 = 圆 */
  chinRadius: number
}

export function computeFaceMetrics(
  landmarks: P3[],
  imgWidth: number,
  imgHeight: number,
): FaceMetrics {
  // 关键点是归一化的，但图像未必是正方形；换算到「等比像素」空间再算距离，
  // 否则宽高比会污染所有长度比例
  const aspect = imgWidth / imgHeight
  const Q = (i: number): P2 => ({ x: landmarks[i].x * aspect, y: landmarks[i].y })

  const iod = dist(Q(IOD_PAIR[0]), Q(IOD_PAIR[1]))
  const iodPx = iod * imgHeight
  const N = (v: number) => v / iod

  /* ---------- 三停 ---------- */
  const browLineY = mean(THREE_COURTS.browLine.map((i) => landmarks[i].y))
  const yTop = landmarks[THREE_COURTS.top].y
  const yNose = landmarks[THREE_COURTS.noseBase].y
  const yChin = landmarks[THREE_COURTS.chin].y

  // landmark 10 是网格顶端而非发际线，直接用会把上停系统性低估约一半。
  // HAIRLINE_FACTOR 是由规范脸推出的修正系数，详见 thresholds.ts
  const upperRaw = (browLineY - yTop) * HAIRLINE_FACTOR
  const middleRaw = yNose - browLineY
  const lowerRaw = yChin - yNose
  const total = upperRaw + middleRaw + lowerRaw || 1
  const courts = {
    upper: upperRaw / total,
    middle: middleRaw / total,
    lower: lowerRaw / total,
  }
  const maxDiff = Math.max(
    Math.abs(courts.upper - courts.middle),
    Math.abs(courts.middle - courts.lower),
    Math.abs(courts.upper - courts.lower),
  )

  /* ---------- 五眼 ---------- */
  const eyeWidthL = dist(Q(EYE.left.outer), Q(EYE.left.inner))
  const eyeWidthR = dist(Q(EYE.right.outer), Q(EYE.right.inner))
  const eyeUnit = (eyeWidthL + eyeWidthR) / 2
  const faceWidth = dist(Q(FACE_WIDEST.left), Q(FACE_WIDEST.right))
  const fiveEye = eyeUnit > 1e-9 ? faceWidth / eyeUnit : 0
  const innerGap = eyeUnit > 1e-9 ? dist(Q(EYE.left.inner), Q(EYE.right.inner)) / eyeUnit : 0

  /* ---------- 眉 ---------- */
  const browMetrics = (side: Side): BrowMetrics => {
    const B = BROW[side]
    const inner = Q(B.inner)
    const outer = Q(B.outer)
    const eyeW = side === 'left' ? eyeWidthL : eyeWidthR
    // 沿眉下缘取点算曲率
    const lowerPts = B.lower.map((i) => Q(i))
    // 眉尾在 lower 数组末端，保证首尾是两端
    const ordered = [...lowerPts].sort((a, b) => (side === 'left' ? a.x - b.x : b.x - a.x))

    return {
      lenRatio: eyeW > 1e-9 ? dist(inner, outer) / eyeW : 0,
      curvature: sagittaRatio(ordered),
      signedCurvature: signedSagittaRatio(ordered),
      tilt: elevationDeg(inner, outer),
      // y 向下为正，故「眉头更高」= 眉头 y 更小
      innerHigher: N(outer.y - inner.y),
      gapRatio: eyeUnit > 1e-9 ? dist(Q(BROW.left.inner), Q(BROW.right.inner)) / eyeUnit : 0,
    }
  }

  /* ---------- 眼 ---------- */
  const eyeMetrics = (side: Side): EyeMetrics => {
    const E = EYE[side]
    const I = IRIS[side]
    const w = side === 'left' ? eyeWidthL : eyeWidthR
    const h = dist(Q(E.upper), Q(E.lower))

    // 虹膜半径：环上四点到中心的平均距离
    const center = Q(I.center)
    const irisR = mean(I.ring.map((i) => dist(Q(i), center)))
    const irisD = irisR * 2

    const lidTop = Q(E.upper).y
    const lidBottom = Q(E.lower).y
    const irisTop = center.y - irisR
    const irisBottom = center.y + irisR

    // 可见虹膜高度
    const visible = Math.max(0, Math.min(lidBottom, irisBottom) - Math.max(lidTop, irisTop))

    return {
      aspect: w > 1e-9 ? h / w : 0,
      width: N(w),
      canthalTilt: elevationDeg(Q(E.inner), Q(E.outer)),
      openness: irisD > 1e-9 ? Math.min(1, visible / irisD) : 0,
      // 虹膜上方 / 下方露出的巩膜（相对眼高）
      scleraUpper: h > 1e-9 ? Math.max(0, irisTop - lidTop) / h : 0,
      scleraLower: h > 1e-9 ? Math.max(0, lidBottom - irisBottom) / h : 0,
    }
  }

  /* ---------- 鼻 ---------- */
  const noseRoot = Q(NASAL_ROOT)
  const noseBase = Q(SUBNASALE)
  const noseTip = Q(NOSE.tip)
  const bridgePts = NOSE.bridge.map((i) => Q(i))
  const bridgeDeviation = Math.max(
    ...bridgePts.map((p) => Math.abs(signedDistToLine(p, noseRoot, noseBase))),
  )
  const noseLen = dist(noseRoot, noseBase)
  const alarWidth = dist(Q(NOSE.alarLeft), Q(NOSE.alarRight))

  // 深度类度量用原始 z（MediaPipe 的 z 与 x 同尺度，越小越靠近镜头）
  const zOf = (i: number) => landmarks[i].z
  const innerCanthusZ = (zOf(EYE.left.inner) + zOf(EYE.right.inner)) / 2
  // 山根相对内眦：z 更小 = 更突出
  const bridgeHeightRaw = (innerCanthusZ - zOf(NASAL_ROOT)) / iod
  // 鼻尖相对鼻翼：突出量
  const alarZ = (zOf(NOSE.alarLeft) + zOf(NOSE.alarRight)) / 2
  const tipProtrusion = (alarZ - zOf(NOSE.tip)) / iod

  const nose: NoseMetrics = {
    len: N(noseLen),
    alarWidth: N(alarWidth),
    aspect: noseLen > 1e-9 ? alarWidth / noseLen : 0,
    bridgeDeviation: N(bridgeDeviation),
    // 深度量映射到 0–1。
    // ⚠️ 初稿的区间是拍脑袋定的（[-0.02,0.12] 和 [0.02,0.18]），实测两个参考脸
    // 都直接顶到 1.0 —— 意味着所有人都会拿到「山根隆起 + 准头丰圆」的满值。
    // 现按两个独立参考取中心：
    //   tipProtrusion   规范脸 0.410 / 真人脸 0.354 → 中心 0.38
    //   bridgeHeightRaw 规范脸 0.222 / 真人脸 0.205 → 中心 0.21
    // 带宽仍是估计（n=2 定不出方差），待真实样本回归。CALIBRATE
    bridgeHeight: clamp01((bridgeHeightRaw - 0.13) / 0.16),
    tipFullness: clamp01((tipProtrusion - 0.24) / 0.28),
    tipDroop: N(noseTip.y - Q(5).y) - N(Q(5).y - Q(195).y),
  }

  /* ---------- 口 ---------- */
  const mouthWidth = dist(Q(MOUTH.cornerLeft), Q(MOUTH.cornerRight))
  const upperThick = dist(Q(MOUTH.upperOuter), Q(MOUTH.upperInner))
  const lowerThick = dist(Q(MOUTH.lowerInner), Q(MOUTH.lowerOuter))
  const lipMidY = (Q(MOUTH.upperInner).y + Q(MOUTH.lowerInner).y) / 2
  const cornerY = (Q(MOUTH.cornerLeft).y + Q(MOUTH.cornerRight).y) / 2

  const mouth: MouthMetrics = {
    width: N(mouthWidth),
    widthOverAlar: alarWidth > 1e-9 ? mouthWidth / alarWidth : 0,
    lipThickness: N(upperThick + lowerThick),
    upperLower: lowerThick > 1e-9 ? upperThick / lowerThick : 0,
    // y 向下为正：口角比唇中线高 → cornerY 更小 → 上扬为正
    cornerLift: mouthWidth > 1e-9 ? (lipMidY - cornerY) / mouthWidth : 0,
    philtrumLen: N(dist(Q(PHILTRUM.top), Q(PHILTRUM.bottom))),
  }

  /* ---------- 轮廓 ---------- */
  const faceHeight = Math.abs(Q(CHIN_BOTTOM).y - Q(FOREHEAD_TOP).y)
  const zygoWidth = dist(Q(ZYGOMATIC.left), Q(ZYGOMATIC.right))
  const jawWidth = dist(Q(GONION.left), Q(GONION.right))
  const foreheadWidth = dist(Q(FOREHEAD_SIDE.left), Q(FOREHEAD_SIDE.right))
  const templeWidth = dist(Q(TEMPLE.left), Q(TEMPLE.right))

  // 下颌角：在 GONION 处，向上到颧点、向下到下巴的夹角
  const gonialAngle = angleAt(Q(ZYGOMATIC.right), Q(GONION.right), Q(CHIN_BOTTOM))

  // 下巴曲率：取下巴附近 5 个轮廓点，曲率半径 ≈ 弦长 / (8×矢高/弦长)
  const chinArc = [150, 149, 176, 148, 152, 377, 400, 378, 379].map((i) => Q(i))
  const chinSag = sagittaRatio(chinArc)
  const chinChord = dist(chinArc[0], chinArc[chinArc.length - 1])
  const chinRadius = chinSag > 1e-6 ? N(chinChord / (8 * chinSag)) : 10

  const contour: ContourMetrics = {
    faceWidth: N(faceWidth),
    faceHeight: N(faceHeight),
    fw: faceHeight > 1e-9 ? faceWidth / faceHeight : 0,
    zygoWidth: N(zygoWidth),
    jawWidth: N(jawWidth),
    foreheadWidth: N(foreheadWidth),
    templeWidth: N(templeWidth),
    jc: zygoWidth > 1e-9 ? jawWidth / zygoWidth : 0,
    fc: zygoWidth > 1e-9 ? foreheadWidth / zygoWidth : 0,
    gonialAngle,
    chinRadius,
  }

  /* ---------- 对称性 ---------- */
  const axisPts = FACE_OVAL.map((i) => Q(i))
  const { center, dir } = principalAxis(axisPts)
  const devs = MIRROR_PAIRS.map(([l, r]) => {
    const mirrored = reflectAcrossLine(Q(l), center, dir)
    return dist(mirrored, Q(r)) / iod
  })
  const symmetryScore = clamp01(1 - median(devs) / 0.08)

  /* ---------- 田宅宫 ---------- */
  const browLowerY = (side: Side) => Math.max(...BROW[side].lower.map((i) => Q(i).y))
  const tianzhaiRaw = mean([
    Q(EYE.left.upper).y - browLowerY('left'),
    Q(EYE.right.upper).y - browLowerY('right'),
  ])

  return {
    iodPx,
    threeCourts: { ...courts, maxDiff },
    fiveEye,
    innerGap,
    brow: { left: browMetrics('left'), right: browMetrics('right') },
    eye: { left: eyeMetrics('left'), right: eyeMetrics('right') },
    nose,
    mouth,
    contour,
    symmetryScore: +symmetryScore.toFixed(2),
    tianzhai: eyeUnit > 1e-9 ? tianzhaiRaw / eyeUnit : 0,
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** 眉毛浓密度：眉多边形内的暗像素占比 */
export function browDensity(img: ImageData, landmarks: P3[], side: Side): number {
  const poly = BROW[side].all.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y }))
  return darkPixelRatio(img, poly)
}

/** 眉尾散乱度：眉尾 1/3 区域的灰度标准差 */
export function browTailDispersion(img: ImageData, landmarks: P3[], side: Side): number {
  const tailIdx = side === 'left' ? [300, 293, 283, 276] : [70, 63, 53, 46]
  const poly = tailIdx.map((i) => ({ x: landmarks[i].x, y: landmarks[i].y }))
  return grayStdev(img, poly)
}

function polyPixels(img: ImageData, poly: P2[], fn: (r: number, g: number, b: number) => void) {
  const { width, height, data } = img
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs) * width))
  const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs) * width))
  const y0 = Math.max(0, Math.floor(Math.min(...ys) * height))
  const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys) * height))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4
      fn(data[i], data[i + 1], data[i + 2])
    }
  }
}

function darkPixelRatio(img: ImageData, poly: P2[]): number {
  const grays: number[] = []
  polyPixels(img, poly, (r, g, b) => grays.push(0.299 * r + 0.587 * g + 0.114 * b))
  if (grays.length < 20) return 0
  // 用区域自身的中位数做自适应阈值，抵消整体明暗
  const m = median(grays)
  const dark = grays.filter((v) => v < m * 0.8).length
  return +(dark / grays.length).toFixed(3)
}

function grayStdev(img: ImageData, poly: P2[]): number {
  const grays: number[] = []
  polyPixels(img, poly, (r, g, b) => grays.push(0.299 * r + 0.587 * g + 0.114 * b))
  if (grays.length < 20) return 0
  return +(stdev(grays) / 255).toFixed(3)
}
