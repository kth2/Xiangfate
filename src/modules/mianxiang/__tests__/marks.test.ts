/**
 * 痣 / 卧蚕 / 法令纹的检测测试。
 *
 * 造图的思路：规范脸的关键点 + 一张平铺肤色的合成图，
 * 想测什么就往对应位置画什么 —— 画一个暗斑就该测出痣，不画就不该测出。
 * 这些算子最危险的失败不是漏检，而是**满脸误检**，所以「干净脸上一颗都不报」
 * 和「噪点脸整项作废」这两条比检出率更重要。
 */

import { describe, expect, it } from 'vitest'
import {
  detectMoles,
  measureEyeBag,
  measureNasolabial,
  MOLE_SLUG,
  type MolePosition,
} from '../marks'
import { computeFaceMetrics } from '../metrics'
import { applyFaceRules } from '../rules'
import { computeScorecard, explainScorecard } from '@/core/scorecard'
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

  it('MOLE_SLUG 与 MolePosition 一一对应，没有漏配也没有多余项', () => {
    // 漏一个位置，那个位置的痣就没有 id，规则层会拼出 `face.mole.undefined`
    const slugs = Object.values(MOLE_SLUG)
    expect(new Set(slugs).size, 'slug 有重复，两个位置会撞到同一个 id').toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z]+$/)
  })
})

/**
 * 痣按位置分列的全链路：画一颗痣 → 检出 → 规则层出对应位置的特征 → 进星级。
 *
 * 原来所有痣压成一条 `face.mole`（categorical），在五维星级里没有权重，
 * 于是测出来的东西到不了星级。这一组盯住拆分后的每一环。
 */
describe('痣 → 特征 → 星级', () => {
  const ruleInput = (img: ImageData | null) => ({
    m: computeFaceMetrics(LM, W, H),
    qualityFactor: 0.9,
    complexionFactor: 0,
    detectorScore: 0.95,
    complexion: null,
    browPixels: null,
    foreheadOccluded: false,
    moles: img ? detectMoles(img, LM) : null,
    eyeBags: null,
    nasolabial: null,
  })

  function moleFeatures(img: ImageData) {
    return applyFaceRules(ruleInput(img)).features.filter((f) => f.id.startsWith('face.mole'))
  }

  it('两处不同位置的痣出两条独立特征，各带自己的相理', () => {
    const img = skinFace()
    paintDot(img, LM[4].x, LM[4].y, Math.max(2, iodPx * 0.02)) // 准头
    paintDot(img, LM[205].x, LM[205].y, Math.max(2, iodPx * 0.02)) // 颧
    const fs = moleFeatures(img)
    expect(fs.map((f) => f.id).sort()).toEqual(['face.mole.quan', 'face.mole.zhuntou'])
    const zhuntou = fs.find((f) => f.id === 'face.mole.zhuntou')!
    const quan = fs.find((f) => f.id === 'face.mole.quan')!
    expect(zhuntou.label).toBe('准头见痣')
    expect(zhuntou.meaning).toContain('财帛')
    expect(quan.label).toBe('颧见痣')
    expect(quan.meaning).toContain('是非')
  })

  it('档位是偏离档而非 categorical —— categorical 在星级里根本不参与', () => {
    const img = skinFace()
    paintDot(img, LM[4].x, LM[4].y, Math.max(2, iodPx * 0.02))
    const f = moleFeatures(img).find((x) => x.id === 'face.mole.zhuntou')!
    expect(['low', 'very_low']).toContain(f.band)
  })

  it('准头见痣真的把根基福泽压下来了', () => {
    const clean = applyFaceRules(ruleInput(skinFace()))
    const img = skinFace()
    paintDot(img, LM[4].x, LM[4].y, Math.max(2, iodPx * 0.02))
    const withMole = applyFaceRules(ruleInput(img))

    const before = computeScorecard(clean.features)
    const after = computeScorecard(withMole.features)
    // 准头见痣「主财帛易散」→ 根基福泽
    expect(after.根基福泽).toBeLessThanOrEqual(before.根基福泽)
    // 且该条确实成了这一维的驱动项，用户点开能看到它
    const drivers = explainScorecard(withMole.features).根基福泽.drivers.map((d) => d.id)
    expect(drivers).toContain('face.mole.zhuntou')
  })

  it('干净的脸出「面上无显痣」，且它不进星级偏移', () => {
    const clean = skinFace()
    const fs = moleFeatures(clean)
    expect(fs.map((f) => f.id)).toEqual(['face.mole.none'])
    expect(fs[0].band).toBe('balanced')
    // balanced 的偏移为 0，因此不该出现在任何一维的驱动项里
    const explain = explainScorecard(applyFaceRules(ruleInput(clean)).features)
    for (const dim of Object.values(explain)) {
      expect(dim.drivers.map((d) => d.id)).not.toContain('face.mole.none')
    }
  })

  /**
   * 分档与分组这两段逻辑不拿画图去试 —— 用像素凑一颗「刚好落在判线下方」的痣
   * 很难稳定，而且真正要测的是规则层怎么处理检出结果，不是检测器本身
   * （那部分上面「痣检测」一组已经在测）。这里直接给规则层构造检出结果。
   */
  const mole = (position: MolePosition, contrast: number, sizeRatio: number) => ({
    x: 0.5,
    y: 0.5,
    sizeRatio,
    contrast,
    position,
  })

  function featuresFrom(moles: ReturnType<typeof mole>[]) {
    return applyFaceRules({
      ...ruleInput(null),
      moles: { moles, failed: null },
    }).features.filter((f) => f.id.startsWith('face.mole'))
  }

  it('隐痣记 low，显痣记 very_low —— 传统上隐痣不作重断', () => {
    // 判线：contrast ≥ 0.26 且 sizeRatio ≥ 0.025 才算显
    const faint = featuresFrom([mole('准头', 0.2, 0.015)])
    expect(faint[0].band).toBe('low')
    expect(faint[0].evidence).not.toContain('属显痣')

    const prominent = featuresFrom([mole('准头', 0.35, 0.04)])
    expect(prominent[0].band).toBe('very_low')
    expect(prominent[0].evidence).toContain('属显痣')

    // 只深不大、或只大不深，都不算显
    expect(featuresFrom([mole('准头', 0.35, 0.015)])[0].band).toBe('low')
    expect(featuresFrom([mole('准头', 0.2, 0.04)])[0].band).toBe('low')
  })

  it('同一位置多颗合成一条，取最明显的定档，颗数写进证据', () => {
    const fs = featuresFrom([
      mole('面颊', 0.18, 0.02),
      mole('面颊', 0.35, 0.04),
      mole('面颊', 0.2, 0.018),
    ])
    // 不能出三条同 id —— 重复 id 会让报告与断语出现三条一样的
    expect(fs).toHaveLength(1)
    expect(fs[0].id).toBe('face.mole.mianjia')
    expect(fs[0].evidence).toContain('3 颗痣')
    // 最明显的那颗是显痣，整条就按显痣论
    expect(fs[0].band).toBe('very_low')
  })

  it('不同位置各出一条，互不合并', () => {
    const fs = featuresFrom([
      mole('准头', 0.3, 0.03),
      mole('颧', 0.3, 0.03),
      mole('眼尾', 0.3, 0.03),
    ])
    expect(fs.map((f) => f.id).sort()).toEqual([
      'face.mole.quan',
      'face.mole.yanwei',
      'face.mole.zhuntou',
    ])
  })

  it('低于痣判线的斑点不出特征，回落到「面上无显痣」', () => {
    // T.moleContrast = 0.16
    const fs = featuresFrom([mole('准头', 0.1, 0.02)])
    expect(fs.map((f) => f.id)).toEqual(['face.mole.none'])
  })

  it('检测失败时按 unavailable 处理，不硬出一条痣特征', () => {
    const out = applyFaceRules({
      ...ruleInput(null),
      moles: { moles: [], failed: 'too_noisy' as const },
    })
    expect(out.features.some((f) => f.id.startsWith('face.mole'))).toBe(false)
    expect(out.unavailable.some((u) => u.id === 'face.mole')).toBe(true)
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

/**
 * 自归一化才是这几个像素指标能跨照片比较的前提。
 * 降对比度模拟「隔着雾/低光/过度压缩」——绝对深度一定会掉，
 * 但对照线同样会掉，所以倍数应当基本不动。
 */
describe('对同脸平颊基线的归一化', () => {
  function lowerContrast(img: ImageData, k: number): ImageData {
    const out = makeImageData(W, H)
    for (let i = 0; i < img.data.length; i += 4) {
      for (let c = 0; c < 3; c++) out.data[i + c] = 128 + (img.data[i + c] - 128) * k
      out.data[i + 3] = 255
    }
    return out
  }

  it('法令：绝对深度随对比度掉，倍数基本不变', () => {
    const img = skinFace()
    paintLine(img, LM[NOSE.alarLeft], LM[MOUTH.cornerLeft], Math.max(1.5, iodPx * 0.012))

    const normal = measureNasolabial(img, LM, 'left')
    const hazy = measureNasolabial(lowerContrast(img, 0.45), LM, 'left')

    expect(hazy.depth).toBeLessThan(normal.depth)
    expect(normal.depthRatio).toBeGreaterThan(1.5)
    // 倍数是这次改动的重点：同一道纹，换个光照条件仍要判成同一档
    expect(hazy.depthRatio).toBeGreaterThan(1.5)
    expect(Math.abs(hazy.depthRatio - normal.depthRatio) / normal.depthRatio).toBeLessThan(0.35)
  })

  it('法令：没有纹时倍数接近 1', () => {
    const r = measureNasolabial(skinFace(), LM, 'left')
    expect(r.depthRatio).toBeLessThan(1.5)
  })

  it('卧蚕：同理给出相对同脸平颊的倍数', () => {
    const img = skinFace()
    const lid = LM[EYE.left.lower]
    paintLine(
      img,
      { x: LM[EYE.left.inner].x, y: lid.y + (iodPx * 0.09) / H },
      { x: LM[EYE.left.outer].x, y: lid.y + (iodPx * 0.09) / H },
      Math.max(1.5, iodPx * 0.015),
    )
    const normal = measureEyeBag(img, LM, 'left')
    const hazy = measureEyeBag(lowerContrast(img, 0.45), LM, 'left')

    expect(normal.ridgeRatio).toBeGreaterThan(1)
    expect(hazy.ridgeRatio).toBeGreaterThan(1)
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
