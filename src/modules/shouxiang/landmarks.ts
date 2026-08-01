/**
 * MediaPipe Hand Landmarker 21 点索引，以及标准掌画布的坐标约定。
 *
 * ⚠️ 这 21 个点**全部是骨骼关节点，不含任何掌纹信息**。
 * 掌纹必须靠 workers/palmline.worker.ts 里的图像处理管线提取。
 */

export const HAND = {
  wrist: 0,
  thumbCmc: 1, thumbMcp: 2, thumbIp: 3, thumbTip: 4,
  indexMcp: 5, indexPip: 6, indexDip: 7, indexTip: 8,
  middleMcp: 9, middlePip: 10, middleDip: 11, middleTip: 12,
  ringMcp: 13, ringPip: 14, ringDip: 15, ringTip: 16,
  pinkyMcp: 17, pinkyPip: 18, pinkyDip: 19, pinkyTip: 20,
} as const

export const FINGERS = {
  thumb: [HAND.thumbCmc, HAND.thumbMcp, HAND.thumbIp, HAND.thumbTip],
  index: [HAND.indexMcp, HAND.indexPip, HAND.indexDip, HAND.indexTip],
  middle: [HAND.middleMcp, HAND.middlePip, HAND.middleDip, HAND.middleTip],
  ring: [HAND.ringMcp, HAND.ringPip, HAND.ringDip, HAND.ringTip],
  pinky: [HAND.pinkyMcp, HAND.pinkyPip, HAND.pinkyDip, HAND.pinkyTip],
} as const

export type FingerName = keyof typeof FINGERS

/**
 * 标准掌画布。
 * 归一化之后，掌纹的位置先验才有稳定意义。
 *
 *   x: 0 → W  从拇指侧到小指侧（左手先水平翻转，统一按右手朝向处理）
 *   y: 0 → H  从指根到腕部
 *   掌宽（食指 MCP ↔ 小指 MCP）映射为 W 的一半，居中
 */
export const CANVAS = { W: 512, H: 512 } as const

/** 四个锚点在标准画布上的目标位置 */
export const CANVAS_ANCHORS = {
  /** 食指 MCP → 左上 */
  indexMcp: { x: CANVAS.W * 0.25, y: CANVAS.H * 0.18 },
  /** 小指 MCP → 右上 */
  pinkyMcp: { x: CANVAS.W * 0.75, y: CANVAS.H * 0.18 },
  /** 腕点 → 下方中央 */
  wrist: { x: CANVAS.W * 0.5, y: CANVAS.H * 0.9 },
  /** 中指 MCP → 上方中央，作为第 4 个约束 */
  middleMcp: { x: CANVAS.W * 0.5, y: CANVAS.H * 0.14 },
} as const

/**
 * 七大掌丘在标准画布上的中心（比例坐标）。
 * 半径统一取 0.12 × W。
 */
export const MOUNTS = {
  木星丘: { x: 0.25, y: 0.3 },
  土星丘: { x: 0.5, y: 0.28 },
  太阳丘: { x: 0.66, y: 0.3 },
  水星丘: { x: 0.79, y: 0.33 },
  金星丘: { x: 0.2, y: 0.66 },
  月丘: { x: 0.82, y: 0.68 },
  火星丘: { x: 0.5, y: 0.5 },
} as const

export type MountKey = keyof typeof MOUNTS
export const MOUNT_RADIUS = 0.12
