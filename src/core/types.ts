/**
 * 端侧特征提取 → AI 解读 的唯一契约。
 * 与 schemas/*.schema.json 保持一致（由 src/core/__tests__/schema.test.ts 校验）。
 * 详见 docs/03-schema.md。
 *
 * ⚠️ 本文件属于 src/core，不得 import React 或触碰 DOM —— 迁移 RN/Flutter 时要整体复用。
 */

export const SCHEMA_VERSION = '1.0.0' as const

export type AnalysisType = 'mianxiang' | 'shouxiang' | 'guxiang' | 'tixiang'

export type Band = 'very_low' | 'low' | 'balanced' | 'high' | 'very_high' | 'categorical'

/** 特征来源。unavailable 的项不进 features，而进 unavailable 数组。 */
export type FeatureStatus = 'measured' | 'inferred' | 'self_reported'

export type UnavailableReason =
  | 'not_observable' // 任何照片都拍不到（枕骨、顶骨、耳后骨）
  | 'not_captured' // 用户没提供所需照片
  | 'low_confidence' // 测到了但置信度 < 0.35
  | 'out_of_scope' // 照片本质承载不了（干湿手、声音）

/** policy_excluded 只写本地审计日志，永不进入发送给 AI 的 payload。 */
export type AuditReason = UnavailableReason | 'policy_excluded'

export type ShotKind =
  | 'front'
  | 'profile'
  | 'left_palm'
  | 'right_palm'
  | 'full_body'
  | 'half_body'

export type Classic =
  | '麻衣神相'
  | '柳庄相法'
  | '神相全编'
  | '水镜神相'
  | '冰鉴'
  | '太清神鉴'
  | '人伦大统赋'

export type FeatureCategory =
  // 面相
  | '三停' | '五眼' | '眉' | '眼' | '鼻' | '口' | '耳' | '十二宫' | '气色' | '五形' | '脸型' | '对称'
  // 手相
  | '手型' | '指形' | '掌线' | '掌丘' | '掌色' | '左右手'
  // 骨相
  | '头型' | '九骨' | '骨肉' | '骨骼粗细' | '体骨' | '特殊骨相'
  // 体相
  | '体型' | '身体比例' | '体态' | '肌肤气色' | '自评'

export interface FeatureItem {
  /** 稳定的点分路径 ID，如 face.threeCourts.balance */
  id: string
  category: FeatureCategory
  /** 传统术语，AI 应优先使用此词 */
  label: string
  band: Band
  value: string | number
  status: FeatureStatus
  /** [0.35, 1]。低于 0.35 会被降级到 unavailable */
  confidence: number
  /** 必须含具体数值，供 AI 引用与用户核对 */
  evidence: string
  /** 已过 docs/07 内容策略的释义要点 */
  meaning: string
  source: Classic | null
}

export interface UnavailableItem {
  id: string
  label: string
  reason: UnavailableReason
  detail: string
}

export interface Quality {
  score: number
  resolution: 'ok' | 'low'
  lighting: 'ok' | 'dim' | 'harsh' | 'color_cast'
  sharpness: 'ok' | 'blurry'
  /** 欧拉角（度）。仅面相/骨相有 */
  pose?: { yaw: number; pitch: number; roll: number }
  occlusion: OcclusionKind[]
  /** 人类可读的问题短语，供 UI 提示 */
  issues: string[]
}

export type OcclusionKind =
  | 'hair_covers_forehead'
  | 'hair_covers_ears'
  | 'glasses'
  | 'mask'
  | 'hand_partial'
  | 'body_partial'
  | 'loose_clothing'

export interface Subject {
  /** 不提供 18 岁以下选项 —— 本应用不面向未成年人 */
  ageBand?: '18-25' | '26-35' | '36-45' | '46-55' | '56+' | null
  /** 仅用于称谓，不得用于差异化断言 */
  gender?: 'male' | 'female' | 'unspecified'
  isSelf?: boolean
  focusTopics?: string[]
}

export interface Raw {
  normalizer?: { type: 'IOD' | 'PW' | 'SW' | 'world'; valuePx: number }
  metrics?: Record<string, number | string | object | null>
  complexion?: Record<string, unknown>
}

export const SCORE_DIMENSIONS = [
  '气度格局',
  '才智思辨',
  '人际情感',
  '执行意志',
  '根基福泽',
] as const

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number]

/** 1–5 星。由 core/scorecard.ts 本地算出，AI 不参与 —— 保证同一照片评分一致。 */
export type Scorecard = Record<ScoreDimension, number>

export interface Policy {
  disclaimerRequired: true
  forbidTopics: string[]
}

export const DEFAULT_FORBID_TOPICS = [
  '寿命',
  '疾病诊断',
  '具体事件时间',
  '婚姻成败',
  '生育',
  '政治',
] as const

export interface AnalysisEnvelope {
  schemaVersion: typeof SCHEMA_VERSION
  analysisType: AnalysisType
  analysisId: string
  capturedAt: string
  locale: string
  subject?: Subject
  capture: { shots: ShotKind[]; quality: Quality }
  features: FeatureItem[]
  derived: DerivedByType[AnalysisType]
  raw?: Raw
  unavailable: UnavailableItem[]
  scorecard: Scorecard
  policy: Policy
}

/* ============================================================
   各类型的 derived
   ============================================================ */

export type Palace =
  | '命宫' | '财帛宫' | '兄弟宫' | '田宅宫' | '男女宫' | '疾厄宫'
  | '迁移宫' | '奴仆宫' | '官禄宫' | '福德宫' | '相貌宫' | '父母宫'

export type FiveElement = '金' | '木' | '水' | '火' | '土'
export type FaceShape = '圆脸' | '瓜子脸' | '由字脸' | '国字脸' | '甲字脸'

export interface MianxiangDerived {
  fiveElements: {
    primary: FiveElement | '兼形'
    primaryScore: number
    secondary?: FiveElement | null
    secondaryScore?: number | null
  }
  faceShape: FaceShape
  courtDominance: 'upper' | 'middle' | 'lower' | 'balanced'
  symmetryScore: number
  palaceHighlights?: Palace[]
  palaceCautions?: Palace[]
  /** mesh_top（landmark 10）精度较低，上停 methodPrior 仅 0.65 */
  hairlineSource?: 'mesh_top' | 'segmentation'
}

export type HandType = '原始手' | '方形手' | '圆形手' | '锥形手' | '精神手'
export type PalmLineName = '生命线' | '智慧线' | '感情线' | '命运线' | '太阳线' | '婚姻线'
export type MountName = '木星丘' | '土星丘' | '太阳丘' | '水星丘' | '金星丘' | '月丘' | '火星丘'
export type MountBand = Exclude<Band, 'categorical'> | 'unavailable'

export interface LineDetection {
  /** matchScore >= 0.45 或用户手动校正确认 */
  detected: boolean
  /** 位置先验打分（起点/终点/方向/曲率/长度合理性加权） */
  matchScore: number
  /** 由用户在校正界面手动指定。AI 须标注「（经你本人确认）」 */
  corrected: boolean
}

export interface ShouxiangDerived {
  handType: {
    primary: HandType
    score: number
    secondary?: HandType | null
    secondaryScore?: number | null
  }
  dominantHand?: 'left' | 'right' | null
  handsCaptured: ('left' | 'right')[]
  lineDetection: Partial<Record<PalmLineName, LineDetection>> &
    Record<'生命线' | '智慧线' | '感情线' | '命运线', LineDetection>
  /** 仅双手都采集时给出；否则 null，且 AI 须说明对照暂缺 */
  leftRightComparison?: '右优于左' | '左优于右' | '左右相似' | null
  mountProfile: Record<MountName, MountBand>
}

export type Bone =
  | '颧骨' | '额骨' | '枕骨' | '顶骨' | '颞骨'
  | '鼻骨' | '下颌骨' | '眉骨' | '耳后骨'

export interface GuxiangDerived {
  headShape: {
    value: '圆头型' | '长头型' | '方头型' | '扁头型' | null
    cephalicIndex?: number | null
    status: 'inferred' | 'not_captured'
  }
  boneFleshRatio: number
  boneFleshLabel: '骨多肉少' | '骨肉相称' | '骨少肉多'
  boneThickness: '粗骨型' | '中骨型' | '细骨型'
  observableBones: Bone[]
  inferredBones: Bone[]
  /** AI 严禁对其发言，须在特征识别末尾如实说明 */
  unobservableBones: Bone[]
  /** 龙骨/三台骨/反骨/耳后骨不可观测，永不出现在此 */
  specialForms?: ('虎骨' | '脑后见腮')[]
  bodyBonesCaptured?: boolean
}

export type Somatotype = '内胚型' | '中胚型' | '外胚型' | '平衡型' | '混合型'

export interface TixiangDerived {
  somatotype: {
    primary: Somatotype
    scores: { 内胚: number; 中胚: number; 外胚: number }
  }
  proportion: {
    upperLowerRatio: number
    shoulderHipRatio: number
    armReachLabel?: '垂至大腿中部' | '偏长' | '偏短' | null
    neckLabel?: '长颈' | '适中' | '短颈' | null
    label: string
  }
  posture: {
    trunkTilt: number
    shoulderSlope: number
    weightShift?: number | null
    stanceWidth?: number | null
    label: '直立挺拔' | '微微前倾' | '微微后仰' | '重心偏移' | '体态待观察'
  }
  /** 仅作日常姿态建议，不得写成骨骼疾病或医疗矫正建议 */
  postureCautions?: ('轻度圆肩' | '头部前倾' | '肩线不平' | '重心偏移' | '站姿偏拘谨')[]
  capturedExtent?: 'full_body' | 'half_body'
  segmentationUsed: boolean
  surveyAnswered: boolean
  survey?: {
    voice?: '洪亮' | '柔和' | '低沉' | '清亮'
    speechPace?: '偏快' | '适中' | '偏慢'
    dressStyle?: '整洁得体' | '随意自然' | '时尚前卫' | '传统保守' | '朴素简约'
    /** 仅用于体型指数计算。严禁生成任何与身高相关的价值判断 */
    heightCm?: number | null
    /** 仅用于体型指数计算。严禁生成任何与体重相关的价值判断 */
    weightKg?: number | null
  }
}

export interface DerivedByType {
  mianxiang: MianxiangDerived
  shouxiang: ShouxiangDerived
  guxiang: GuxiangDerived
  tixiang: TixiangDerived
}

/** 便于按类型收窄 derived */
export type EnvelopeOf<T extends AnalysisType> = Omit<AnalysisEnvelope, 'analysisType' | 'derived'> & {
  analysisType: T
  derived: DerivedByType[T]
}
