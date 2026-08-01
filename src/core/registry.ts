/**
 * 四大相术类型的统一注册表。
 * 首页入口、路由、拍摄流程、模型加载全部由此驱动，新增类型只需改这里。
 * 详见 docs/05-capture-guide.md。
 */

import type { AnalysisType, ShotKind } from './types'

export type DetectorKind = 'face' | 'hand' | 'pose'

export interface ShotSpec {
  kind: ShotKind
  /** 拍摄页标题 */
  title: string
  /** 三条要点清单 */
  tips: string[]
  required: boolean
  detector: DetectorKind
}

export interface TypeSpec {
  type: AnalysisType
  /** 中文名 */
  name: string
  pinyin: string
  /** 首页副标题 */
  tagline: string
  /** 首页一句话说明 */
  summary: string
  /** 观察内容（首页展开时显示） */
  aspects: string[]
  /** 知识来源 */
  classics: string[]
  /** 主题色 CSS 变量名 */
  accent: string
  /** 需要的检测器（决定要下载哪些模型） */
  detectors: DetectorKind[]
  shots: ShotSpec[]
  /** 该类型的已知局限，拍摄前如实告知 */
  caveat?: string
}

export const TYPE_SPECS: Record<AnalysisType, TypeSpec> = {
  mianxiang: {
    type: 'mianxiang',
    name: '面相',
    pinyin: 'Miànxiàng',
    tagline: '三停五岳，十二宫垣',
    summary: '看三停比例、五官格局、十二宫与气色。',
    aspects: ['三停 · 五眼', '眉眼鼻口耳', '十二宫', '气色 · 五形'],
    classics: ['麻衣神相', '柳庄相法', '神相全编'],
    accent: 'var(--color-mian)',
    detectors: ['face'],
    shots: [
      {
        kind: 'front',
        title: '拍一张正面照',
        tips: [
          '正对镜头，不低头不抬头，表情自然放松',
          '光线均匀，别背对窗户，也别在头顶强光下',
          '露出额头和双眉，方便看三停与十二宫',
        ],
        required: true,
        detector: 'face',
      },
    ],
  },

  shouxiang: {
    type: 'shouxiang',
    name: '手相',
    pinyin: 'Shǒuxiàng',
    tagline: '掌纹三线，丘壑分明',
    summary: '看手型、四大主线、五指与掌丘。',
    aspects: ['手型 · 指形', '生命 · 智慧 · 感情 · 命运线', '七大掌丘', '左右手对照'],
    classics: ['神相全编', '水镜神相'],
    accent: 'var(--color-shou)',
    detectors: ['hand'],
    shots: [
      {
        kind: 'right_palm',
        title: '拍一张手掌照',
        tips: [
          '掌心朝上摊平，五指自然张开，别用力绷直',
          '别在正午阳光或射灯下拍 —— 硬光会把掌纹拍没',
          '靠窗的散射光，或者阴天的室外，效果最好',
        ],
        required: true,
        detector: 'hand',
      },
      {
        kind: 'left_palm',
        title: '再拍另一只手',
        tips: [
          '左手看先天禀赋，右手看后天努力',
          '两只都拍可以做先天/后天对照',
          '不拍也能出报告，只是少一个维度',
        ],
        required: false,
        detector: 'hand',
      },
    ],
    caveat:
      '掌纹不在关键点模型的输出里，需要额外的图像处理来提取。光线不好时可能认不准，到时候会请你帮忙确认一下。',
  },

  guxiang: {
    type: 'guxiang',
    name: '骨相',
    pinyin: 'Gǔxiàng',
    tagline: '骨为君，肉为臣',
    summary: '从面部轮廓与体态反推骨架格局。',
    aspects: ['颧骨 · 额骨 · 下颌骨', '头型 · 骨骼粗细', '骨肉关系', '肩骨 · 脊椎 · 骨盆'],
    classics: ['太清神鉴', '人伦大统赋'],
    accent: 'var(--color-gu)',
    detectors: ['face', 'pose'],
    shots: [
      {
        kind: 'front',
        title: '先拍正面照',
        tips: [
          '正对镜头，表情放松，别咬牙',
          '尽量露出额头和太阳穴',
          '光线均匀，避免侧面强光',
        ],
        required: true,
        detector: 'face',
      },
      {
        kind: 'profile',
        title: '再拍一张侧面照',
        tips: [
          '完整的侧脸，别转过头也别只转一点',
          '把头发别到耳后，露出耳朵和鬓角',
          '侧面照用来看头部前后径，没有它判断不了头型',
        ],
        required: true,
        detector: 'face',
      },
      {
        kind: 'half_body',
        title: '加一张半身照',
        tips: [
          '可以一起看肩骨、脊椎和骨盆',
          '正面站直，双手自然垂在身侧',
          '不拍也行，这几项会标为「未采集」',
        ],
        required: false,
        detector: 'pose',
      },
    ],
    caveat:
      '照片拍不到骨头。我们是从面部轮廓、下颌线条、肩线这些体表信息反推骨架——这是推估，不是测量。传统九骨里的枕骨、顶骨、耳后骨任何照片都看不到，报告里会如实写明「未观测」。',
  },

  tixiang: {
    type: 'tixiang',
    name: '体相',
    pinyin: 'Tǐxiàng',
    tagline: '形神兼备，动静相参',
    summary: '看体型、身体比例与站姿体态。',
    aspects: ['体型三分', '肩髋比 · 上下身比', '站姿 · 重心', '肌肤气色'],
    classics: ['冰鉴', '神相全编'],
    accent: 'var(--color-ti)',
    detectors: ['pose'],
    shots: [
      {
        kind: 'full_body',
        title: '拍一张全身照',
        tips: [
          '从头到脚都要拍进去，正面站直',
          '双手自然垂在身侧，别插兜、别抱臂',
          '穿合身一点的衣服，宽松外套会看不出体态',
        ],
        required: true,
        detector: 'pose',
      },
    ],
    caveat: '照片测不出绝对身高体重，报告里不会有任何跟高矮胖瘦挂钩的评价。',
  },
}

export const ALL_TYPES: AnalysisType[] = ['mianxiang', 'shouxiang', 'guxiang', 'tixiang']

export function getTypeSpec(type: string): TypeSpec | undefined {
  return (TYPE_SPECS as Record<string, TypeSpec>)[type]
}

export function isAnalysisType(v: string): v is AnalysisType {
  return v in TYPE_SPECS
}
