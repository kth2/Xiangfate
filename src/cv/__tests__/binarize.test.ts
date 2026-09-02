/**
 * 二值化的前景占比。
 *
 * 这条测试是实测逼出来的。掌纹管线的阈值系数原先是 0.35，在合成掌图上
 * 把**三分之一的画面**判成了纹路；细化那样一片区域得到的是一张蔓延全掌的网，
 * 于是追踪出 24 条折线、最长的有 2.42 个掌宽（比任何真掌纹都长），
 * 而其中只有 8% 的长度真的落在纹路上。用户在报告里看到的满掌乱线就是它。
 *
 * 这里不跑 Gabor（8 方向 512² 卷积要几十秒），直接合成一张**响应图** ——
 * 亮脊 + 噪声底，正是 Gabor 应该产出的形态。要钉住的就是这一步：
 * 阈值一松，前景占比就失控。
 */

import { describe, expect, it } from 'vitest'
import { adaptiveThreshold } from '../index'
import { PALMLINE_THRESHOLD_K } from '@/workers/palmline.threshold'

const W = 256
const H = 256

/**
 * 合成响应图：三条亮脊（宽约 3px）压在噪声底上。
 * 脊占的面积约 3 × 3 × 200 / 256² ≈ 2.7%，与真实掌面「纹占几个百分点」相当。
 */
function synthResponse(): { data: Float32Array; width: number; height: number } {
  const data = new Float32Array(W * H)
  let seed = 987654321
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let i = 0; i < data.length; i++) data[i] = 90 + rnd() * 30

  const ridge = (fn: (t: number) => { x: number; y: number }) => {
    for (let t = 0; t <= 1; t += 0.002) {
      const p = fn(t)
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const x = Math.round(p.x) + dx
          const y = Math.round(p.y) + dy
          if (x < 0 || y < 0 || x >= W || y >= H) continue
          const v = 150 * Math.exp(-(dx * dx + dy * dy) / (2 * 1.5 * 1.5))
          const i = y * W + x
          if (data[i] < 90 + v) data[i] = 90 + v
        }
      }
    }
  }
  ridge((t) => ({ x: 70 - 30 * Math.sin(Math.PI * t * 0.9), y: 60 + 160 * t }))
  ridge((t) => ({ x: 45 + 160 * t, y: 125 + 20 * t * t }))
  ridge((t) => ({ x: 210 - 150 * t, y: 82 + 15 * Math.sin(Math.PI * t) }))

  return { data, width: W, height: H }
}

const foregroundFraction = (bin: Uint8Array): number => {
  let n = 0
  for (const v of bin) n += v
  return n / bin.length
}

describe('掌纹二值化的前景占比', () => {
  const response = synthResponse()

  it('现用的判线：前景占比落在「掌面里纹路能占的比例」这个量级', () => {
    const f = foregroundFraction(adaptiveThreshold(response, 15, PALMLINE_THRESHOLD_K))
    // 合成图里脊约占 2.7%；允许到 8%，再多就不是纹而是纹理了
    expect(f, `前景占了 ${(f * 100).toFixed(1)}%，纹路不可能占这么多掌面`).toBeLessThan(0.08)
    // 也不能一条都不留
    expect(f, '一个前景像素都没有，纹路会全部丢掉').toBeGreaterThan(0.002)
  })

  it('回归：0.35 那个旧判线会把三成画面判成纹路', () => {
    // 留着这一条是为了让「为什么不能把 k 调回去」有据可查
    const f = foregroundFraction(adaptiveThreshold(response, 15, 0.35))
    expect(f).toBeGreaterThan(0.25)
  })

  it('判线越严，前景越少 —— 单调，没有意外的反转', () => {
    let prev = 1
    for (const k of [0.35, 0.8, 1.2, 1.6, 2.0, 2.5]) {
      const f = foregroundFraction(adaptiveThreshold(response, 15, k))
      expect(f, `k=${k} 处不单调`).toBeLessThanOrEqual(prev)
      prev = f
    }
  })
})
