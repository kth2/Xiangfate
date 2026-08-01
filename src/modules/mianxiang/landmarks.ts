/**
 * MediaPipe Face Landmarker 478 点索引常量。
 *
 * ⚠️ 这里的每一个索引都经过校验，不是凭记忆写的。
 * 校验方式见 src/modules/mianxiang/__tests__/landmarks.test.ts：
 * 拿 MediaPipe 官方的 canonical_face_model（468 顶点的规范人脸三维网格）+
 * tasks-vision 包内置的 FACE_LANDMARKS_* 连接集，用几何性质反推每个点的身份。
 *
 * 坐标约定：
 *   x 向图像右侧增大 —— 对正面照而言即被摄者的**左**侧（与 MediaPipe 的
 *   LEFT_EYE / RIGHT_EYE 命名一致，LEFT_* 的 x 更大）
 *   y 向下增大（图像坐标），规范模型里则是向上为正 —— 测试中已做符号处理
 *   z 越小越靠近镜头
 *
 * 命名一律以**被摄者**为准：LEFT = 被摄者的左侧。
 */

/* ============ 面部中轴（上 → 下）============ */
/** 网格顶端，近似发际线。⚠️ 不是真实发际线，上停测量因此只给 0.65 的方法可靠度 */
export const FOREHEAD_TOP = 10
/** 额中 */
export const FOREHEAD_MID = 151
/** 印堂 / 眉心（命宫所在） */
export const GLABELLA = 9
/** 鼻根上缘 */
export const NASION_UPPER = 8
/** 山根（两眼之间的鼻梁起点） */
export const NASAL_ROOT = 168
/** 年寿（鼻梁中段，疾厄宫所在） */
export const NASAL_BRIDGE_MID = 6
/** 鼻梁下段 */
export const NASAL_BRIDGE_LOW = 195
/** 准头 / 鼻尖 —— 全网格最前突的点（z 最小 / 规范模型 z 最大） */
export const NOSE_TIP = 4
/** 鼻小柱下端 */
export const COLUMELLA = 1
/** 鼻底（subnasale）—— 三停中「中停」的下边界 */
export const SUBNASALE = 2
/** 人中中段 */
export const PHILTRUM_MID = 164
/** 上唇外缘中点（唇珠） */
export const UPPER_LIP_OUTER = 0
/** 上唇内缘中点 */
export const UPPER_LIP_INNER = 13
/** 下唇内缘中点 */
export const LOWER_LIP_INNER = 14
/** 下唇外缘中点 */
export const LOWER_LIP_OUTER = 17
/** 颏唇沟 */
export const MENTOLABIAL = 200
/** 颏部 */
export const CHIN_MID = 199
/** 下巴尖（网格最低点） */
export const CHIN_BOTTOM = 152

/** 三停的三个分界基准 */
export const THREE_COURTS = {
  top: FOREHEAD_TOP,
  browLine: [107, 336] as const, // 两眉头上缘，取 y 均值作眉心线
  noseBase: SUBNASALE,
  chin: CHIN_BOTTOM,
} as const

/* ============ 眼 ============ */
export const EYE = {
  left: { outer: 263, inner: 362, upper: 386, lower: 374 },
  right: { outer: 33, inner: 133, upper: 159, lower: 145 },
} as const

/** 虹膜。468/473 是中心，其余四点是上下左右边缘。dlib 68 点没有这个，是本项目判断眼神清明的关键 */
export const IRIS = {
  left: { center: 473, ring: [474, 475, 476, 477] as const },
  right: { center: 468, ring: [469, 470, 471, 472] as const },
} as const

/* ============ 眉 ============ */
/**
 * 官方 FACE_LANDMARKS_*_EYEBROW 集合的 10 个点。
 * inner = 最靠中线的点（不是 107/336 —— 那两个是眉头**上缘**）
 * outer = 眉尾，同时也是该侧眉的最低点
 */
export const BROW = {
  left: {
    all: [276, 282, 283, 285, 293, 295, 296, 300, 334, 336] as const,
    inner: 285,
    outer: 300,
    innerTop: 336,
    tail: 276,
    upper: [285, 295, 282, 283, 276] as const,
    lower: [336, 296, 334, 293, 300] as const,
  },
  right: {
    all: [46, 52, 53, 55, 63, 65, 66, 70, 105, 107] as const,
    inner: 55,
    outer: 70,
    innerTop: 107,
    tail: 46,
    upper: [55, 65, 52, 53, 46] as const,
    lower: [107, 66, 105, 63, 70] as const,
  },
} as const

/* ============ 鼻 ============ */
export const NOSE = {
  tip: NOSE_TIP,
  root: NASAL_ROOT,
  base: SUBNASALE,
  bridge: [NASAL_ROOT, NASAL_BRIDGE_MID, 197, NASAL_BRIDGE_LOW, 5, NOSE_TIP] as const,
  /** 鼻翼最外缘。⚠️ 不是常被引用的 48/278（那两点更靠内，|x| 小 10%） */
  alarLeft: 358,
  alarRight: 129,
  /** 鼻翼弧线上的点，用于鼻翼饱满度 */
  alarCurveLeft: [278, 344, 439, 294, 331, 358] as const,
  alarCurveRight: [48, 115, 219, 64, 102, 129] as const,
  /** 鼻孔下缘，用于「鼻孔外露」判定 */
  nostrilLeft: 326,
  nostrilRight: 97,
} as const

/* ============ 口 ============ */
export const MOUTH = {
  cornerLeft: 291,
  cornerRight: 61,
  upperOuter: UPPER_LIP_OUTER,
  upperInner: UPPER_LIP_INNER,
  lowerInner: LOWER_LIP_INNER,
  lowerOuter: LOWER_LIP_OUTER,
  /** 唇峰（丘比特弓），上唇最高的两点 */
  cupidBow: [37, 267] as const,
} as const

/** 人中：鼻底 → 上唇外缘 */
export const PHILTRUM = { top: SUBNASALE, mid: PHILTRUM_MID, bottom: UPPER_LIP_OUTER } as const

/* ============ 面部轮廓 ============ */
/**
 * 脸最宽处。⚠️ 是 127/356（|x| = 7.74），不是常被引用的 234/454（|x| = 7.66）。
 * 用于「五眼」与脸型判断。
 */
export const FACE_WIDEST = { left: 356, right: 127 } as const
/** 颧弓高度处的轮廓点，用于颧宽（骨相复用） */
export const ZYGOMATIC = { left: 454, right: 234 } as const
/** 太阳穴/额角，用于迁移宫与额宽 */
export const TEMPLE = { left: 251, right: 21 } as const
/** 额部轮廓最宽处（官禄宫、额骨） */
export const FOREHEAD_SIDE = { left: 332, right: 103 } as const
/** 下颌角（腮），用于颌宽与颌角（骨相复用） */
export const GONION = { left: 397, right: 172 } as const
/** 下颌轮廓中段 */
export const JAW_MID = { left: 365, right: 136 } as const
/** 下巴两侧（奴仆宫 / 地阁） */
export const CHIN_SIDE = { left: 377, right: 148 } as const

/** 面部外轮廓（36 点，来自官方 FACE_LANDMARKS_FACE_OVAL），用于脸型曲率 */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const

/* ============ 十二宫的采样区（多边形顶点）============ */
/**
 * 每个宫位对应一组顶点，围成一个采样多边形。
 * 用于像素级的饱满度 / 纹路 / 气色采样。
 */
export const PALACE_REGIONS = {
  /** 命宫 · 印堂 */
  命宫: [107, 336, 285, 55],
  /** 财帛宫 · 鼻头鼻翼 */
  财帛宫: [4, 129, 2, 358],
  /** 兄弟宫 · 双眉（左右各一，此处给右眉，左眉镜像） */
  兄弟宫: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  /** 田宅宫 · 眉眼之间（右侧） */
  田宅宫: [107, 66, 105, 63, 70, 33, 159, 133],
  /** 男女宫 · 眼下泪堂（右侧卧蚕） */
  男女宫: [33, 145, 133, 121, 128],
  /** 疾厄宫 · 年寿（鼻梁中段） */
  疾厄宫: [168, 6, 197, 195, 122, 351],
  /** 迁移宫 · 额角（右侧） */
  迁移宫: [21, 54, 103, 67, 109, 10],
  /** 奴仆宫 · 地阁两侧（右侧） */
  奴仆宫: [172, 136, 150, 149, 176, 148, 152],
  /** 官禄宫 · 额中 */
  官禄宫: [10, 109, 67, 107, 9, 336, 297, 338],
  /** 福德宫 · 眉上外侧（右侧） */
  福德宫: [70, 63, 105, 66, 107, 151, 108],
  /** 父母宫 · 日月角（左右额，取左右各一） */
  父母宫: [103, 67, 109, 10, 338, 297, 332],
} as const

export type PalaceKey = keyof typeof PALACE_REGIONS

/* ============ 气色采样区 ============ */
/** 采样多边形。避开高光与阴影后取中位数，见 core/color.ts */
export const COMPLEXION_REGIONS = {
  额中: [10, 109, 67, 107, 9, 336, 297, 338],
  左颧: [345, 346, 347, 330, 266, 425, 411, 352],
  右颧: [116, 117, 118, 101, 36, 205, 187, 123],
  鼻头: [4, 45, 220, 115, 218, 275, 440, 344, 275],
  下巴: [152, 148, 176, 149, 150, 169, 396, 175, 377],
} as const

export type ComplexionRegionKey = keyof typeof COMPLEXION_REGIONS

/** 归一化基准：双眼外眦距离。所有长度都除以它，因此与拍摄距离无关 */
export const IOD_PAIR = [EYE.right.outer, EYE.left.outer] as const

/** 用于对称性评分的镜像点对（左, 右） */
export const MIRROR_PAIRS: readonly (readonly [number, number])[] = [
  [EYE.left.outer, EYE.right.outer],
  [EYE.left.inner, EYE.right.inner],
  [EYE.left.upper, EYE.right.upper],
  [EYE.left.lower, EYE.right.lower],
  [BROW.left.inner, BROW.right.inner],
  [BROW.left.outer, BROW.right.outer],
  [BROW.left.innerTop, BROW.right.innerTop],
  [NOSE.alarLeft, NOSE.alarRight],
  [MOUTH.cornerLeft, MOUTH.cornerRight],
  [FACE_WIDEST.left, FACE_WIDEST.right],
  [ZYGOMATIC.left, ZYGOMATIC.right],
  [GONION.left, GONION.right],
  [TEMPLE.left, TEMPLE.right],
  [FOREHEAD_SIDE.left, FOREHEAD_SIDE.right],
  [CHIN_SIDE.left, CHIN_SIDE.right],
] as const

/** 中轴点集合，用于求面部中线 */
export const MIDLINE = [
  FOREHEAD_TOP, FOREHEAD_MID, GLABELLA, NASAL_ROOT, NASAL_BRIDGE_MID,
  NASAL_BRIDGE_LOW, NOSE_TIP, SUBNASALE, UPPER_LIP_OUTER, LOWER_LIP_OUTER,
  CHIN_MID, CHIN_BOTTOM,
] as const
