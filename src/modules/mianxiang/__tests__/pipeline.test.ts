/**
 * 面相全链路的黄金测试。
 *
 * 没有真人照片，但有 MediaPipe 官方的规范人脸网格 —— 把它正交投影到图像坐标，
 * 就得到一张「完美正脸」的合成关键点。规范脸是左右严格对称、比例标准的，
 * 因此对输出有明确的预期：三停接近均衡、五眼接近 5.0、对称度接近满分。
 *
 * 这能抓住的问题：索引用错、y 轴方向搞反、归一化基准写错、分档阈值离谱、
 * 规则映射串位。抓不住的是真实照片的噪声 —— 那需要真实样本回归校准。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { computeFaceMetrics } from '../metrics'
import { applyFaceRules } from '../rules'
import { computeScorecard } from '@/core/scorecard'
import { IMG_H, IMG_W, projectCanonical } from './canonical'

const LM = projectCanonical()
const M = computeFaceMetrics(LM, IMG_W, IMG_H)

describe('规范脸的几何度量', () => {
  it('三停经发际线修正后接近均衡 —— 规范脸应当是标准三停', () => {
    const { upper, middle, lower, maxDiff } = M.threeCourts
    expect(upper + middle + lower).toBeCloseTo(1, 5)
    for (const v of [upper, middle, lower]) {
      expect(v).toBeGreaterThan(0.28)
      expect(v).toBeLessThan(0.4)
    }
    // 这是 HAIRLINE_FACTOR 的定义式：规范脸修正后三停应当均衡
    expect(maxDiff).toBeLessThan(0.05)
  })

  it('中停与下停几乎等长 —— 这一段不受发际线影响，是真实测量', () => {
    expect(M.threeCourts.middle / M.threeCourts.lower).toBeCloseTo(1, 1)
  })

  it('五眼落在规范脸的实测值附近', () => {
    // 传统理想是 5.0，规范脸实测 5.98 —— 阈值以后者为中心
    expect(M.fiveEye).toBeCloseTo(5.98, 1)
  })

  it('两眼间距落在规范脸的实测值附近', () => {
    expect(M.innerGap).toBeCloseTo(1.43, 1)
  })

  it('外眦上扬左右一致且为小正角 —— 用仰角而非方向角，避免一侧变成 ±180°', () => {
    expect(M.eye.left.canthalTilt).toBeCloseTo(M.eye.right.canthalTilt, 3)
    expect(M.eye.left.canthalTilt).toBeGreaterThan(0)
    expect(M.eye.left.canthalTilt).toBeLessThan(10)
  })

  it('规范脸严格对称，对称度应接近满分', () => {
    expect(M.symmetryScore).toBeGreaterThan(0.95)
  })

  it('左右两侧的度量互为镜像', () => {
    expect(M.brow.left.lenRatio).toBeCloseTo(M.brow.right.lenRatio, 3)
    expect(M.eye.left.aspect).toBeCloseTo(M.eye.right.aspect, 3)
    expect(M.eye.left.canthalTilt).toBeCloseTo(M.eye.right.canthalTilt, 2)
  })

  it('鼻梁笔直（规范模型的鼻梁在中轴上）', () => {
    expect(M.nose.bridgeDeviation).toBeLessThan(0.01)
  })

  it('口宽大于鼻翼宽 —— 传统「口宜大于鼻翼」', () => {
    expect(M.mouth.widthOverAlar).toBeGreaterThan(1)
  })

  it('各比例都是有限数，没有除零', () => {
    const flat = JSON.stringify(M)
    expect(flat).not.toContain('null')
    expect(flat).not.toContain('Infinity')
    expect(flat).not.toContain('NaN')
  })

  it('归一化基准与图像宽高比无关', () => {
    // 换一个宽高比重算，比例类度量应该基本不变
    const wide = computeFaceMetrics(LM, IMG_H, IMG_W)
    expect(wide.threeCourts.upper).toBeCloseTo(M.threeCourts.upper, 6)
  })
})

describe('规则映射', () => {
  const out = applyFaceRules({
    m: M,
    qualityFactor: 0.9,
    complexionFactor: 0,
    detectorScore: 1,
    complexion: null,
    browPixels: null,
    foreheadOccluded: false,
    moles: null,
    eyeBags: null,
    nasolabial: null,
  })

  it('产出了成规模的特征集', () => {
    expect(out.features.length).toBeGreaterThanOrEqual(12)
  })

  it('每条特征都自洽：置信度达标、evidence 带数字', () => {
    for (const f of out.features) {
      expect(f.confidence).toBeGreaterThanOrEqual(0.35)
      expect(f.confidence).toBeLessThanOrEqual(1)
      expect(f.evidence).toMatch(/\d/)
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.meaning.length).toBeGreaterThan(0)
    }
  })

  it('特征 id 不重复', () => {
    const ids = out.features.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('气色关不掉时应进 unavailable，而不是静默消失', () => {
    expect(out.unavailable.some((u) => u.id === 'face.complexion')).toBe(true)
  })

  it('耳相被显式标为不可观测', () => {
    const ear = out.unavailable.find((u) => u.id === 'face.ear')
    expect(ear?.reason).toBe('not_observable')
  })

  it('meaning 里不含任何被内容策略禁止的词', () => {
    const banned = ['短命', '克夫', '肝胆', '心术不正', '注定', '必定', '难产', '孤独终老']
    for (const f of out.features) {
      for (const w of banned) expect(f.meaning).not.toContain(w)
    }
  })

  it('derived 完整，五形与脸型都有结论', () => {
    expect(out.derived.fiveElements.primary).toBeTruthy()
    expect(out.derived.faceShape).toBeTruthy()
    expect(out.derived.symmetryScore).toBeGreaterThan(0.9)
  })

  it('评分卡五维都落在 1–5', () => {
    const sc = computeScorecard(out.features)
    for (const v of Object.values(sc)) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(5)
    }
  })

  it('同样的输入得到同样的评分 —— 星级必须可复现', () => {
    const a = computeScorecard(out.features)
    const b = computeScorecard(out.features)
    expect(a).toEqual(b)
  })
})

describe('产出的 envelope 符合 JSON Schema', () => {
  it('features / unavailable / derived 三者都能通过校验', () => {
    const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true })
    addFormats(ajv)
    const schema = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../../schemas/analysis-envelope.schema.json', import.meta.url)),
        'utf8',
      ),
    )
    const validate = ajv.compile(schema)

    const out = applyFaceRules({
      m: M,
      qualityFactor: 0.9,
      complexionFactor: 0,
      detectorScore: 1,
      complexion: null,
      browPixels: null,
      foreheadOccluded: false,
      moles: null,
      eyeBags: null,
      nasolabial: null,
    })

    const env = {
      schemaVersion: '1.0.0',
      analysisType: 'mianxiang',
      analysisId: '00000000-0000-4000-8000-000000000000',
      capturedAt: new Date().toISOString(),
      locale: 'zh-CN',
      capture: {
        shots: ['front'],
        quality: {
          score: 0.9,
          resolution: 'ok',
          lighting: 'ok',
          sharpness: 'ok',
          pose: { yaw: 0, pitch: 0, roll: 0 },
          occlusion: [],
          issues: [],
        },
      },
      features: out.features,
      derived: out.derived,
      unavailable: out.unavailable,
      scorecard: computeScorecard(out.features),
      policy: { disclaimerRequired: true, forbidTopics: ['寿命'] },
    }

    const ok = validate(env)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })
})
