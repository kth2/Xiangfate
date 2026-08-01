/**
 * 掌丘饱满度。
 *
 * ⚠️ 这是间接推估：丘是凸起，在漫射光下比周围略亮，且周围有掌纹形成的暗谷。
 * 用「区域中位亮度相对掌面中位亮度」作代理，methodPrior 只给 0.5。
 */

import { median } from '@/core/geom'
import type { Band } from '@/core/types'
import { CANVAS, MOUNTS, MOUNT_RADIUS, type MountKey } from './landmarks'

export type MountBandLocal = Exclude<Band, 'categorical'>

export interface MountResult {
  fullness: number
  band: MountBandLocal
}

export function computeMounts(palm: ImageData): Record<MountKey, MountResult> {
  const { width, height, data } = palm

  // 掌面整体亮度基准：取中央大圆内的中位亮度
  const palmSamples: number[] = []
  const cx = width / 2
  const cy = height / 2
  const rPalm = width * 0.38
  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      if (Math.hypot(x - cx, y - cy) > rPalm) continue
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      palmSamples.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }
  }
  const palmMedian = median(palmSamples) || 128
  const palmSd = stdev(palmSamples) || 20

  const out = {} as Record<MountKey, MountResult>
  const r = width * MOUNT_RADIUS

  for (const key of Object.keys(MOUNTS) as MountKey[]) {
    const c = MOUNTS[key]
    const mx = c.x * CANVAS.W
    const my = c.y * CANVAS.H
    const samples: number[] = []

    for (let y = Math.max(0, Math.floor(my - r)); y < Math.min(height, my + r); y++) {
      for (let x = Math.max(0, Math.floor(mx - r)); x < Math.min(width, mx + r); x++) {
        if (Math.hypot(x - mx, y - my) > r) continue
        const i = (y * width + x) * 4
        if (data[i + 3] < 128) continue
        samples.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
      }
    }

    if (samples.length < 50) {
      out[key] = { fullness: 0.5, band: 'balanced' }
      continue
    }

    // 相对掌面的亮度偏移，用掌面标准差归一
    const z = (median(samples) - palmMedian) / palmSd
    const fullness = clamp01(0.5 + z * 0.35)
    out[key] = { fullness: +fullness.toFixed(2), band: toBandLocal(fullness) }
  }

  return out
}

function toBandLocal(v: number): MountBandLocal {
  if (v <= 0.28) return 'very_low'
  if (v < 0.42) return 'low'
  if (v <= 0.62) return 'balanced'
  if (v < 0.78) return 'high'
  return 'very_high'
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

export const MOUNT_MEANING: Record<MountKey, { high: string; low: string; excess: string }> = {
  木星丘: {
    high: '自信有野心，领导意愿强',
    low: '安于本分，不争先，宜有意识地培养主张',
    excess: '自我期许很高，可留意对自己的评价是否过严',
  },
  土星丘: {
    high: '稳重踏实，责任感强',
    low: '偏重当下，长线规划可以再多一些',
    excess: '思虑深沉，宜多让自己放松',
  },
  太阳丘: {
    high: '有艺术气质，乐观开朗',
    low: '务实为主，审美偏克制',
    excess: '表现欲较强，注意张弛有度',
  },
  水星丘: {
    high: '善于沟通，有商业头脑',
    low: '不善辞令，宜主动表达',
    excess: '沟通与商业敏感度高，可留意分寸',
  },
  金星丘: {
    high: '生命力旺盛，热情开朗',
    low: '体力偏弱，宜规律作息',
    excess: '精力充沛，注意张弛有度',
  },
  月丘: {
    high: '想象力丰富，直觉敏锐',
    low: '重现实，凭经验行事',
    excess: '想象力极丰富，可多与现实校准',
  },
  火星丘: {
    high: '勇气十足，行动力强',
    low: '偏谨慎，遇事先观望',
    excess: '行动力很强，可留意节奏',
  },
}
