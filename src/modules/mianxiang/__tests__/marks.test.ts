/**
 * 痣 / 卧蚕 / 法令纹的检测测试。
 *
 * 造图的思路：规范脸的关键点 + 一张平铺肤色的合成图，
 * 想测什么就往对应位置画什么 —— 画一个暗斑就该测出痣，不画就不该测出。
 * 这些算子最危险的失败不是漏检，而是**满脸误检**，所以「干净脸上一颗都不报」
 * 和「噪点脸整项作废」这两条比检出率更重要。
 */

import { describe, expect, it } from 'vitest'
import { detectMoles, measureEyeBag, measureNasolabial } from '../marks'
import { EYE, IOD_PAIR, MOUTH, NOSE } from '../landmarks'
import { makeImageData, mulberry32, projectCanonical } from './canonical'

const LM = projectCanonical()
// 用小图跑：算子按 IOD 自适应尺度，分辨率不影响结论，但快很多
const W = 540
const H = 720
const SKIN = [214, 176, 156] as const

const iodPx = Math.abs(LM[IOD_PAIR[0]].x - LM[IOD_PAIR[1]].x) * W

function skinFace(seed = 0x5eed): ImageData {
  const img = makeImageData(W, H)
  const rand = mulberry32(seed)
  for (let i = 0; i < img.data.length; i += 4) {
    // 底噪 ±4：真实照片没有纯色皮肤，去掉噪声等于放宽测试
    const n = (rand() - 0.5) * 8
    img.data[i] = SKIN[0] + n
    img.data[i + 1] = SKIN[1] + n
    img.data[i + 2] = SKIN[2] + n
    img.data[i + 3] = 255
  }
  return img
}

/** 在归一化坐标 (nx, ny) 处画一个暗圆点 */
function paintDot(img: ImageData, nx: number, ny: number, rPx: number, dark = 0.45) {
  const cx = nx * W
  const cy = ny * H
  for (let y = Math.floor(cy - rPx); y <= Math.ceil(cy + rPx); y++) {
    for (let x = Math.floor(cx - rPx); x <= Math.ceil(cx + rPx); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      if (Math.hypot(x - cx, y - cy) > rPx) continue
      const i = (y * W + x) * 4
      img.data[i] *= dark
      img.data[i + 1] *= dark
      img.data[i + 2] *= dark
    }
  }
}

/** 沿两点之间画一条暗线（法令纹） */
function paintLine(img: ImageData, a: { x: number; y: number }, b: { x: number; y: number }, halfW = 1.5) {
  const steps = 400
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    paintDot(img, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, halfW, 0.7)
  }
}

describe('痣检测', () => {
  it('干净的脸上一颗都不报', () => {
    const r = detectMoles(skinFace(), LM)
    expect(r.failed).toBeNull()
    expect(r.moles).toHaveLength(0)
  })

  it('印堂上画一颗，就在印堂测到', () => {
    const img = skinFace()
    paintDot(img, LM[9].x, LM[9].y, Math.max(2, iodPx * 0.02))
    const r = detectMoles(img, LM)
    expect(r.failed).toBeNull()
    expect(r.moles.length).toBeGreaterThanOrEqual(1)
    expect(r.moles.map((m) => m.position)).toContain('印堂')
    expect(r.moles[0].contrast).toBeGreaterThan(0.16)
  })

  it('准头与颧上的痣分别归位', () => {
    const img = skinFace()
    paintDot(img, LM[4].x, LM[4].y, Math.max(2, iodPx * 0.02))
    paintDot(img, LM[205].x, LM[205].y, Math.max(2, iodPx * 0.02))
    const positions = detectMoles(img, LM).moles.map((m) => m.position)
    expect(positions).toContain('准头')
    expect(positions).toContain('颧')
  })

  it('眼睛与眉毛属于排除区，画黑了也不算痣', () => {
    const img = skinFace()
    paintDot(img, LM[EYE.left.lower].x, LM[EYE.left.lower].y, iodPx * 0.03, 0.2)
    paintDot(img, LM[105].x, LM[105].y, iodPx * 0.03, 0.2)
    const r = detectMoles(img, LM)
    expect(r.moles.map((m) => m.position)).not.toContain('眼下')
    expect(r.moles.map((m) => m.position)).not.toContain('眉')
  })

  it('满脸斑点时整项作废，而不是报一堆假痣', () => {
    const img = skinFace()
    const rand = mulberry32(7)
    for (let k = 0; k < 40; k++) {
      // 集中在两颊，避开排除区，模拟雀斑
      paintDot(img, 0.35 + rand() * 0.3, 0.42 + rand() * 0.18, 2)
    }
    const r = detectMoles(img, LM)
    expect(r.failed).toBe('too_noisy')
    expect(r.moles).toHaveLength(0)
  })
})

describe('法令纹', () => {
  it('平脸上测不到纹沟', () => {
    const r = measureNasolabial(skinFace(), LM, 'left')
    expect(r.continuity).toBeLessThan(0.3)
    expect(r.pastMouthCorner).toBe(false)
  })

  it('画一条从鼻翼到口角的暗线就能测到，且连续性高', () => {
    const img = skinFace()
    paintLine(img, LM[NOSE.alarLeft], LM[MOUTH.cornerLeft], Math.max(1.5, iodPx * 0.012))
    const r = measureNasolabial(img, LM, 'left')
    expect(r.depth).toBeGreaterThan(0.07)
    expect(r.continuity).toBeGreaterThan(0.5)
  })

  it('线不过口角时，pastMouthCorner 为 false', () => {
    const img = skinFace()
    const alar = LM[NOSE.alarLeft]
    const corner = LM[MOUTH.cornerLeft]
    // 只画到口角的 60% 处
    paintLine(
      img,
      alar,
      { x: alar.x + (corner.x - alar.x) * 0.6, y: alar.y + (corner.y - alar.y) * 0.6 },
      Math.max(1.5, iodPx * 0.012),
    )
    expect(measureNasolabial(img, LM, 'left').pastMouthCorner).toBe(false)
  })
})

describe('卧蚕 / 泪堂', () => {
  it('平脸上隆起与深陷都接近 0', () => {
    const r = measureEyeBag(skinFace(), LM, 'left')
    expect(r.ridge).toBeLessThan(0.06)
    expect(r.hollow).toBeLessThan(0.06)
  })

  it('下睑缘下方压一道暗沟，隆起量升上来', () => {
    const img = skinFace()
    const lid = LM[EYE.left.lower]
    const inner = LM[EYE.left.inner]
    const outer = LM[EYE.left.outer]
    // 亮脊之下的那道沟：卧蚕的判据就是这个落差
    paintLine(
      img,
      { x: inner.x, y: lid.y + (iodPx * 0.09) / H },
      { x: outer.x, y: lid.y + (iodPx * 0.09) / H },
      Math.max(1.5, iodPx * 0.015),
    )
    const r = measureEyeBag(img, LM, 'left')
    expect(r.ridge).toBeGreaterThan(0.08)
  })
})
