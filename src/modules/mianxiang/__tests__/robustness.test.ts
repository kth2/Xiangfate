/**
 * 稳健性测试：把同一张脸稍微转一点、缩一点，看断语会不会翻。
 *
 * 为什么要有这个 —— 分档是硬阈值，而阈值本身是工程判断（thresholds.ts 里
 * 一堆 CALIBRATE）。一条在头转 3° 就从「印堂宽广」跳到「印堂偏窄」的断语，
 * 不管它多符合相书，都是不可信的。这个测试不需要任何真实照片就能把它们揪出来。
 *
 * 关键点自带 z，所以这里做的是**真的三维旋转**再投影，
 * 而不是把 x 压扁假装转头 —— 后者测不出透视缩短对三停、五眼的影响。
 */

import { describe, expect, it } from 'vitest'
import type { P3 } from '@/core/geom'
import { collectVerdicts } from '@/core/verdicts'
import { computeFaceMetrics } from '../metrics'
import { applyFaceRules } from '../rules'
import { IMG_H, IMG_W, projectCanonical } from './canonical'

const LM = projectCanonical()

/** 绕垂直轴转 yaw、水平轴转 pitch、视线轴转 roll（角度制），再投回图像坐标 */
function rotate(lm: P3[], { yaw = 0, pitch = 0, roll = 0 }): P3[] {
  const rad = (d: number) => (d * Math.PI) / 180
  const [cy, sy] = [Math.cos(rad(yaw)), Math.sin(rad(yaw))]
  const [cp, sp] = [Math.cos(rad(pitch)), Math.sin(rad(pitch))]
  const [cr, sr] = [Math.cos(rad(roll)), Math.sin(rad(roll))]

  // 绕面部中心转，否则旋转会把脸甩出画面
  const cx0 = lm.reduce((s, p) => s + p.x, 0) / lm.length
  const cy0 = lm.reduce((s, p) => s + p.y, 0) / lm.length

  return lm.map((p) => {
    // 归一化坐标的 x、y 尺度不同，先还原成同尺度再转
    let x = (p.x - cx0) * IMG_W
    let y = (p.y - cy0) * IMG_H
    let z = p.z * IMG_W

    ;[x, z] = [x * cy + z * sy, -x * sy + z * cy]
    ;[y, z] = [y * cp - z * sp, y * sp + z * cp]
    ;[x, y] = [x * cr - y * sr, x * sr + y * cr]

    return { x: cx0 + x / IMG_W, y: cy0 + y / IMG_H, z: z / IMG_W }
  })
}

function scale(lm: P3[], k: number): P3[] {
  const cx0 = lm.reduce((s, p) => s + p.x, 0) / lm.length
  const cy0 = lm.reduce((s, p) => s + p.y, 0) / lm.length
  return lm.map((p) => ({
    x: cx0 + (p.x - cx0) * k,
    y: cy0 + (p.y - cy0) * k,
    z: p.z * k,
  }))
}

function verdictsOf(lm: P3[]): string[] {
  const { features } = applyFaceRules({
    m: computeFaceMetrics(lm, IMG_W, IMG_H),
    qualityFactor: 0.9,
    complexionFactor: 0,
    detectorScore: 0.95,
    complexion: null,
    browPixels: null,
    foreheadOccluded: false,
    moles: null,
    eyeBags: null,
    nasolabial: null,
  })
  return collectVerdicts(features).map((v) => v.name).sort()
}

const BASE = verdictsOf(LM)

describe('小幅位姿扰动下的断语稳定性', () => {
  const perturbations: [string, P3[]][] = [
    ['yaw +3°', rotate(LM, { yaw: 3 })],
    ['yaw −3°', rotate(LM, { yaw: -3 })],
    ['pitch +3°', rotate(LM, { pitch: 3 })],
    ['pitch −3°', rotate(LM, { pitch: -3 })],
    ['roll +3°', rotate(LM, { roll: 3 })],
    ['放大 5%', scale(LM, 1.05)],
    ['缩小 5%', scale(LM, 0.95)],
  ]

  it.each(perturbations)('%s 不改变断语集合', (_name, lm) => {
    expect(verdictsOf(lm)).toEqual(BASE)
  })

  it('等比缩放完全不影响 —— 所有量都以 IOD 归一化过', () => {
    expect(verdictsOf(scale(LM, 1.4))).toEqual(BASE)
    expect(verdictsOf(scale(LM, 0.6))).toEqual(BASE)
  })

  /**
   * 这条不是断言「转多少度都不变」，而是记录**从哪个角度开始变**。
   * 失败时说明某条阈值贴得太近，应当调阈值或降置信度，而不是改这个测试。
   */
  it('大角度会改变断语 —— 这是应该的，但要知道门槛在哪', () => {
    const big = verdictsOf(rotate(LM, { yaw: 20 }))
    // 20° 属于「明显没对正镜头」，质量门控本就该拦下；这里只确认它确实会变，
    // 从而证明上面 3° 的稳定不是因为测试本身没在测东西
    expect(big).not.toEqual(BASE)
  })
})

describe('判线余量', () => {
  it('贴近判线的项，置信度被压低且证据里说明了', () => {
    const { features } = applyFaceRules({
      m: computeFaceMetrics(LM, IMG_W, IMG_H),
      qualityFactor: 1,
      complexionFactor: 0,
      detectorScore: 1,
      complexion: null,
      browPixels: null,
      foreheadOccluded: false,
      moles: null,
      eyeBags: null,
      nasolabial: null,
    })
    const borderline = features.filter((f) => f.evidence.includes('贴近分档判线'))
    // 规范脸多数项落在中和区中央，贴线项应当是少数
    expect(borderline.length).toBeLessThan(features.length / 2)
    for (const f of borderline) {
      expect(f.confidence).toBeLessThan(0.95)
    }
  })
})
