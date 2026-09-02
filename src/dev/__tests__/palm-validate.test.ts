/**
 * 手相定标台。
 *
 * 定标数据一旦被信任就会用来改判线，所以这里要证明它算的是对的东西 ——
 * 特别是「病态程度」那一栏：如果它对已知病态的输入给不出信号，
 * 我们就会以为归一化没问题，然后继续在歪掉的画布上定标。
 */

import { describe, expect, it } from 'vitest'
import type { P3 } from '@/core/geom'
import { depthStats, formatPalmReport, mountProbes, warpConditioning, type PalmSample } from '../palm-validate'
import { HAND, MOUNTS, MOUNT_RADIUS, CANVAS_ANCHORS, CANVAS } from '@/modules/shouxiang/landmarks'

/**
 * 一只手的 21 点。默认是解剖比例正常的右手掌面朝镜头；
 * `knuckleArch` 控制中指 MCP 高出「食指—小指」弦多少，即指根那道拱的高度。
 * （下面的扫描证明：无论这个值取多少，单应变换都不正常 —— 详见那条测试的注释）
 */
function hand(knuckleArch = 0.03): P3[] {
  const P: Record<number, [number, number]> = {
    [HAND.wrist]: [0.5, 0.92],
    [HAND.thumbCmc]: [0.34, 0.82],
    [HAND.thumbMcp]: [0.26, 0.72],
    [HAND.thumbIp]: [0.2, 0.63],
    [HAND.thumbTip]: [0.16, 0.55],
    [HAND.indexMcp]: [0.38, 0.5],
    [HAND.indexPip]: [0.36, 0.38],
    [HAND.indexDip]: [0.35, 0.3],
    [HAND.indexTip]: [0.34, 0.23],
    [HAND.middleMcp]: [0.5, 0.5 - knuckleArch],
    [HAND.middlePip]: [0.5, 0.34],
    [HAND.middleDip]: [0.5, 0.25],
    [HAND.middleTip]: [0.5, 0.17],
    [HAND.ringMcp]: [0.61, 0.49],
    [HAND.ringPip]: [0.63, 0.36],
    [HAND.ringDip]: [0.64, 0.28],
    [HAND.ringTip]: [0.65, 0.21],
    [HAND.pinkyMcp]: [0.71, 0.55],
    [HAND.pinkyPip]: [0.75, 0.44],
    [HAND.pinkyDip]: [0.77, 0.38],
    [HAND.pinkyTip]: [0.79, 0.32],
  }
  return Array.from({ length: 21 }, (_, i) => ({ x: P[i][0], y: P[i][1], z: 0 }))
}

function sample(over: Partial<PalmSample> = {}): PalmSample {
  return {
    subjectId: 'A',
    label: 'a_01.jpg',
    side: 'right',
    handedness: 'Right',
    landmarks: hand(),
    imgWidth: 1000,
    imgHeight: 1000,
    detectorScore: 0.95,
    lines: {},
    mounts: {},
    palmMedianLuma: 150,
    ...over,
  }
}

describe('归一化的病态程度', () => {
  it('实测得出：单应变换在正常手上就已经把掌面撕开了', () => {
    const c = warpConditioning(sample())
    // 纯仿射的 wSpread 恒为 1；这里应当明显大于 1
    expect(c.wSpread).toBeGreaterThan(2)
    // 有关节点被甩出画布
    expect(c.landmarksInCanvas).toBeLessThan(21)
  })

  /**
   * 扫一遍指根拱高（0 → 0.12），看有没有哪个手形能让这个变换正常工作。
   *
   * 结论是**没有**。实测：
   *   拱高 0.000 → w 变负（−10.6 ~ −3.4），手被折过去，只剩 6/21 点在画布内
   *   拱高 0.005 → wSpread 3.99
   *   拱高 0.030 → wSpread 6.88
   *   拱高 0.120 → wSpread 28.63
   * 纯仿射的 wSpread 恒为 1.00。
   *
   * 所以病根不是「某些手拍歪了」，而是取点本身：
   * 四组对应点里有三个是 MCP，它们钉住的是指根那道**拱**的形状，
   * 而 CANVAS_ANCHORS 又把目标拱高写死（中指 MCP 比食指/小指高 0.04 个画布高）。
   * 真实手的拱高与这个定值对不上，解算就只能靠强透视分量去凑，
   * 于是消影线穿过掌面。手越拱，凑得越狠。
   */
  it('扫遍所有可能的指根拱高，没有一个能让单应变换正常工作', () => {
    const seen: number[] = []
    for (const arch of [0.005, 0.01, 0.02, 0.03, 0.04, 0.06, 0.08, 0.12]) {
      const c = warpConditioning(sample({ landmarks: hand(arch) }))
      expect(c.wSpread, `拱高 ${arch} 处竟然接近仿射`).toBeGreaterThan(3)
      // 任何手形下都有关节点被甩出画布 —— 每只手都在丢掉一部分
      expect(c.landmarksInCanvas).toBeLessThan(21)
      seen.push(c.wSpread)
    }
    // 拱得越高，与目标拱高的落差越大，凑得越狠
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1])
  })

  it('指根完全平直时变换会把手折过去 —— 分母变负，比值无意义', () => {
    const c = warpConditioning(sample({ landmarks: hand(0) }))
    expect(c.wMin).toBeLessThan(0)
    expect(c.wSpread).toBe(Infinity)
  })

  it('四个锚点本身仍然精确命中 —— 病的不是解算，是取点', () => {
    const c = warpConditioning(sample())
    const near = (a: { x: number; y: number }, bx: number, by: number) =>
      Math.abs(a.x - bx) < 1e-3 && Math.abs(a.y - by) < 1e-3
    expect(near(c.warped[HAND.indexMcp], CANVAS_ANCHORS.indexMcp.x / CANVAS.W, CANVAS_ANCHORS.indexMcp.y / CANVAS.H)).toBe(true)
    expect(near(c.warped[HAND.wrist], CANVAS_ANCHORS.wrist.x / CANVAS.W, CANVAS_ANCHORS.wrist.y / CANVAS.H)).toBe(true)
  })

  it('左手会先镜像，因此左右两只同形的手得到同一份诊断', () => {
    const right = warpConditioning(sample())
    const mirroredLm = hand().map((p) => ({ ...p, x: 1 - p.x }))
    const left = warpConditioning(
      sample({ side: 'left', handedness: 'Left', landmarks: mirroredLm }),
    )
    expect(left.wSpread).toBeCloseTo(right.wSpread, 1)
  })
})

describe('掌纹响应分布', () => {
  const withDepths = (ds: number[]): PalmSample =>
    sample({
      lines: Object.fromEntries(
        ds.map((d, i) => [
          ['生命线', '智慧线', '感情线', '命运线', '太阳线', '婚姻线'][i],
          {
            matchScore: 0.8, lengthRatio: 1, depth: d, continuity: 0.9,
            curvature: 0.1, signedCurvature: -0.1, branches: 0,
            doubled: false, endRising: false, corrected: false,
          },
        ]),
      ),
    })

  it('分位算得对 —— 判线要按这些数来定，算错就白收样本了', () => {
    const st = depthStats([withDepths([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])])!
    expect(st.n).toBe(6)
    expect(st.min).toBe(0.1)
    expect(st.max).toBe(0.6)
    expect(st.median).toBeGreaterThanOrEqual(0.3)
    expect(st.median).toBeLessThanOrEqual(0.4)
  })

  it('可以只看某一条线', () => {
    const st = depthStats([withDepths([0.11, 0.22, 0.33])], '智慧线')!
    expect(st.n).toBe(1)
    expect(st.median).toBe(0.22)
  })

  it('一条线都没归类出来时返回 null，不假装有分布', () => {
    expect(depthStats([sample()])).toBeNull()
  })
})

describe('掌丘取样圆', () => {
  it('把外沿 x 摊出来 —— 越出被锚定的指根线者，圆里必有非手部像素', () => {
    const s = sample({
      mounts: Object.fromEntries(
        Object.keys(MOUNTS).map((k) => [
          k,
          { sampleCount: 800, medianLuma: 160, fullness: 0.5, band: 'balanced' },
        ]),
      ),
    })
    const probes = mountProbes([s])
    const moon = probes.find((p) => p.key === '月丘')!
    expect(moon.outerX).toBeCloseTo(MOUNTS.月丘.x + MOUNT_RADIUS, 3)
    expect(moon.outerX).toBeGreaterThan(CANVAS_ANCHORS.pinkyMcp.x / CANVAS.W)
    expect(moon.medianLumaOffset).toBe(10)
  })
})

describe('报告', () => {
  it('出得来，且把「不能用它重定丘位」这句写在纸面上', () => {
    const txt = formatPalmReport({
      version: 1,
      exportedAt: '2026-09-02T00:00:00Z',
      samples: [sample()],
    })
    expect(txt).toContain('归一化的病态程度')
    expect(txt).toContain('掌纹响应分布')
    // 这句是刻意留的护栏：定标数据回答不了掌缘的问题
    expect(txt).toContain('不能')
    expect(txt).toContain('掌缘')
  })

  it('一只手都没有时也不崩', () => {
    expect(() =>
      formatPalmReport({ version: 1, exportedAt: 'x', samples: [] }),
    ).not.toThrow()
  })
})
