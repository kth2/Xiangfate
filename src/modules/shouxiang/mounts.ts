/**
 * 掌丘饱满度。
 *
 * ⚠️ 这是间接推估：丘是凸起，在漫射光下比周围略亮，且周围有掌纹形成的暗谷。
 * 用「区域中位亮度相对掌面中位亮度」作代理，methodPrior 只给 0.5。
 */

import { median } from '@/core/geom'
import type { Band } from '@/core/types'
import { CANVAS, MOUNTS, MOUNT_RADIUS, type MountKey } from './landmarks'

export type MountBandLocal = Exclude<Band, 'categorical'> | 'unavailable'

export interface MountResult {
  /** band 为 unavailable 时无意义 */
  fullness: number
  band: MountBandLocal
  /** 取样圆内实际取到的像素数。太少说明圆有一大块在画布外 */
  sampleCount: number
  /** 取样圆内的中位亮度。与掌面基准对照，可看出圆压的是不是皮肤 */
  medianLuma: number
}

export interface MountsResult {
  mounts: Record<MountKey, MountResult>
  /** 掌面整体的中位亮度，作为各丘的对照基准 */
  palmMedianLuma: number
}

/**
 * 采样圆越过掌缘的丘 —— 它们量到的有一部分不是手。
 *
 * 算术摊开来讲：画布锚点把小指 MCP 钉在 x = 0.75、食指 MCP 钉在 x = 0.25，
 * 采样半径是 0.12 个画布宽。于是
 *   · 月丘   中心 0.82 → 圆一直伸到 x = 0.94
 *   · 水星丘 中心 0.79 → 伸到 x = 0.91
 * 手掌不会从自己的指根线再向尺侧探出 0.16–0.19 个画布宽，
 * 所以这两个圆里必然含有非手部像素。实测印证过：一张手掌照的报告里，
 * 月丘的标号直接落在背景地砖上，而它照样出了一个「饱满度」。
 *
 * 亮度代理分不出皮肤和地砖，因此这不是「测得不准」，是**在量别的东西**。
 * 在拿到真实掌缘数据、把丘位重新定标之前，这两个丘一律不出结论。
 *
 * ⚠️ 这不是最终答案 —— 正确的做法是按真实手掌把 MOUNTS 的中心与半径重设，
 * 那要等 dev/validate.ts 收到真实样本。在此之前宁可不说。
 * 金星丘（中心 0.20，圆伸到 0.08）在桡侧也越过了食指 MCP 的 0.25，
 * 但大鱼际本来就明显外鼓于指根线，与尺侧不同量级；暂予保留，同样列入待定标。
 */
const OFF_PALM: MountKey[] = ['月丘', '水星丘']

export function computeMounts(palm: ImageData): MountsResult {
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
    if (OFF_PALM.includes(key)) {
      out[key] = { fullness: 0.5, band: 'unavailable', sampleCount: 0, medianLuma: 0 }
      continue
    }
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

    /**
     * 采样不足原本回一个 { 0.5, 'balanced' } —— 那是把「没量到」说成「中和」，
     * 与 neutralFallback 当年那个毛病同源。没量到就该如实标为不可用。
     */
    if (samples.length < 50) {
      out[key] = { fullness: 0.5, band: 'unavailable', sampleCount: samples.length, medianLuma: 0 }
      continue
    }

    // 相对掌面的亮度偏移，用掌面标准差归一
    const med = median(samples)
    const z = (med - palmMedian) / palmSd
    const fullness = clamp01(0.5 + z * 0.35)
    out[key] = {
      fullness: +fullness.toFixed(2),
      band: toBandLocal(fullness),
      sampleCount: samples.length,
      medianLuma: +med.toFixed(1),
    }
  }

  return { mounts: out, palmMedianLuma: +palmMedian.toFixed(1) }
}

function toBandLocal(v: number): Exclude<MountBandLocal, 'unavailable'> {
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
    low: '安于本分，不争先，主张不立',
    excess: '过盛主傲慢自负，好凌驾于人',
  },
  土星丘: {
    high: '稳重踏实，责任感强',
    low: '偏重当下，无长远之谋',
    excess: '过盛主忧思沉重、性情孤僻，不合于众',
  },
  太阳丘: {
    high: '有艺术气质，乐观开朗',
    low: '务实为主，审美偏克制',
    excess: '过盛主好名浮夸，虚荣而少实',
  },
  水星丘: {
    high: '善于沟通，有商业头脑',
    low: '不善辞令，拙于应对',
    excess: '过盛主机巧多变、言语多机锋，用心近于狡黠',
  },
  金星丘: {
    high: '生命力旺盛，热情开朗',
    low: '体力偏弱，情性亦淡',
    excess: '过盛主情欲炽盛，易为情所困',
  },
  月丘: {
    high: '想象力丰富，直觉敏锐',
    low: '重现实，凭经验行事',
    excess: '过盛主耽于空想、脱离实际，心易生幻',
  },
  火星丘: {
    high: '勇气十足，行动力强',
    low: '偏谨慎，遇事先观望而少决断',
    excess: '过盛主性烈气刚，争强好斗，易与人争',
  },
}
