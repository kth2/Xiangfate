/**
 * 掌纹描线配色。
 *
 * 一条线一个颜色，名目直接写在图上 —— 这样一眼就能认出哪条是哪条，
 * 不必在图和下方列表之间来回找号。
 *
 * 色相沿用坊间掌纹图普遍的约定（生命线绿、智慧线蓝、感情线红、
 * 事业/命运线黄、太阳线橙、婚姻线紫）。这不是审美偏好：
 * 见过别家掌纹图的人不必重新学一套对应关系。
 *
 * 选色的硬约束有两条，`__tests__/palette.test.ts` 会验：
 *   1. 六条线两两之间在 CIE Lab 里的距离要够远（实测最小 ΔE ≈ 43）——
 *      相邻两条线颜色像，标注图就白画了
 *   2. 每个颜色对白字的对比度 ≥ 4.5 —— 名牌是深底白字，底太浅就糊了
 *
 * 这两条一起把色相压暗了：坊间掌纹图常用的亮橙、亮绿配白字读不了，
 * 于是同一色相取暗一档。传统的对应关系还在（生命绿、智慧蓝、感情红、
 * 命运土黄、太阳橙、婚姻紫），只是不刺眼。
 *
 * 底下还会垫一道半透明黑描边（见 PalmAnnotated），所以浅色线在浅肤色掌面上
 * 也立得住。
 */

import type { PalmLineName } from '@/core/types'

export const LINE_COLORS: Record<PalmLineName, string> = {
  生命线: '#068057',
  智慧线: '#087ea6',
  感情线: '#bf0a37',
  命运线: '#6a7306',
  太阳线: '#a65708',
  婚姻线: '#640abf',
}

/** 掌丘是面不是线，统一用中性墨色，不跟六条线抢色相 */
export const MOUNT_COLOR = '#343a40'

export function colorOf(name: string, kind: 'line' | 'mount'): string {
  if (kind === 'mount') return MOUNT_COLOR
  return LINE_COLORS[name as PalmLineName] ?? MOUNT_COLOR
}
