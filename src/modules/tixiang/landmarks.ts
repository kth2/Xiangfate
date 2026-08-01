/**
 * MediaPipe Pose Landmarker 33 点索引。
 *
 * ⚠️ 体相的所有比例一律用 `worldLandmarks`（米制，原点在髋中心），
 * 与相机距离和焦段无关。图像坐标只用来画可视化叠加层。
 */

export const POSE = {
  nose: 0,
  eyeInnerL: 1, eyeL: 2, eyeOuterL: 3,
  eyeInnerR: 4, eyeR: 5, eyeOuterR: 6,
  earL: 7, earR: 8,
  mouthL: 9, mouthR: 10,
  shoulderL: 11, shoulderR: 12,
  elbowL: 13, elbowR: 14,
  wristL: 15, wristR: 16,
  pinkyL: 17, pinkyR: 18,
  indexL: 19, indexR: 20,
  thumbL: 21, thumbR: 22,
  hipL: 23, hipR: 24,
  kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28,
  heelL: 29, heelR: 30,
  footL: 31, footR: 32,
} as const

/** 判断是否拍到了下半身 —— 决定腿部比例与站姿重心能不能算 */
export const LOWER_BODY = [POSE.kneeL, POSE.kneeR, POSE.ankleL, POSE.ankleR] as const

/** 上半身核心点，缺任何一个都无法做体相 */
export const UPPER_BODY = [
  POSE.shoulderL, POSE.shoulderR, POSE.hipL, POSE.hipR,
] as const

/** 肌肤气色采样区（归一化图像坐标下的多边形，由关键点围成） */
export const SKIN_REGIONS = {
  颈部: [POSE.earL, POSE.earR, POSE.shoulderR, POSE.shoulderL],
  前臂: [POSE.elbowL, POSE.wristL, POSE.indexL, POSE.pinkyL],
} as const
