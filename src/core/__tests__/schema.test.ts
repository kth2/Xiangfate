/**
 * 守住 src/core/types.ts 与 schemas/*.schema.json 的一致性。
 * 手写 TS 类型省掉了 codegen 依赖，代价是必须有这个测试兜底 ——
 * 一份符合 TS 类型的 envelope 必须同时通过 JSON Schema 校验。
 */

import { describe, expect, it } from 'vitest'
import Ajv from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import {
  DEFAULT_FORBID_TOPICS,
  SCHEMA_VERSION,
  type AnalysisEnvelope,
  type MianxiangDerived,
} from '../types'
import { BAND_VALUE, MIN_CONFIDENCE, partitionByConfidence, toBand } from '../band'
import { ALL_TYPES, TYPE_SPECS } from '../registry'

function loadSchema(name: string) {
  const p = fileURLToPath(new URL(`../../../schemas/${name}`, import.meta.url))
  return JSON.parse(readFileSync(p, 'utf8'))
}

// allowUnionTypes 是必需的：FeatureItem.value 为 string|number，多处为 T|null
const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true })
addFormats(ajv)

// ajv 按 $id 去重，同一个 schema 编译两次会抛错 —— 这里缓存住
const compiled = new Map<string, ReturnType<typeof ajv.compile>>()
function validator(name: string) {
  let v = compiled.get(name)
  if (!v) {
    v = ajv.compile(loadSchema(name))
    compiled.set(name, v)
  }
  return v
}

const ENVELOPE = 'analysis-envelope.schema.json'

const derived: MianxiangDerived = {
  fiveElements: { primary: '土', primaryScore: 0.62, secondary: '金', secondaryScore: 0.41 },
  faceShape: '国字脸',
  courtDominance: 'balanced',
  symmetryScore: 0.91,
  palaceHighlights: ['财帛宫', '官禄宫'],
  palaceCautions: ['迁移宫'],
  hairlineSource: 'mesh_top',
}

const envelope: AnalysisEnvelope = {
  schemaVersion: SCHEMA_VERSION,
  analysisType: 'mianxiang',
  analysisId: '8f2c1e40-6a3b-4d21-9c77-0e5b1a9d3f22',
  capturedAt: '2026-08-01T10:22:00+08:00',
  locale: 'zh-CN',
  subject: { ageBand: '26-35', gender: 'unspecified', isSelf: true, focusTopics: ['事业'] },
  capture: {
    shots: ['front'],
    quality: {
      score: 0.86,
      resolution: 'ok',
      lighting: 'ok',
      sharpness: 'ok',
      pose: { yaw: -3.2, pitch: 4.1, roll: 1 },
      occlusion: ['hair_covers_forehead'],
      issues: ['额头部分被头发遮挡，上停测量置信度下降'],
    },
  },
  features: [
    {
      id: 'face.threeCourts.balance',
      category: '三停',
      label: '三停平均',
      band: 'balanced',
      value: '34.1% : 33.1% : 32.8%',
      status: 'measured',
      confidence: 0.72,
      evidence: '上停 34.1%，中停 33.1%，下停 32.8%，两两差值均 ≤ 1.3%',
      meaning: '一生运势平稳，各阶段无显著起落',
      source: '麻衣神相',
    },
    {
      id: 'face.brow.length',
      category: '眉',
      label: '眉长过目',
      band: 'high',
      value: 1.17,
      status: 'measured',
      confidence: 0.93,
      evidence: '眉长为同侧眼长的 1.17 倍（阈值 ≥ 1.15）',
      meaning: '传统主兄弟朋友情深、助力较多',
      source: '麻衣神相',
    },
  ],
  derived,
  raw: { normalizer: { type: 'IOD', valuePx: 128.4 }, metrics: { fiveEye: 5.08 } },
  unavailable: [
    {
      id: 'face.ear.all',
      label: '耳相',
      reason: 'not_observable',
      detail: '正面照中双耳被头发遮挡，且面部网格不含耳廓细节点',
    },
  ],
  scorecard: { 气度格局: 4, 才智思辨: 4, 人际情感: 4, 执行意志: 4, 根基福泽: 3 },
  policy: { disclaimerRequired: true, forbidTopics: [...DEFAULT_FORBID_TOPICS] },
}

describe('JSON Schema', () => {
  it('五个 schema 全部可编译', () => {
    for (const name of [
      ENVELOPE,
      'mianxiang.derived.schema.json',
      'shouxiang.derived.schema.json',
      'guxiang.derived.schema.json',
      'tixiang.derived.schema.json',
    ]) {
      expect(() => validator(name)).not.toThrow()
    }
  })

  it('符合 TS 类型的 envelope 通过 schema 校验', () => {
    const validate = validator(ENVELOPE)
    const ok = validate(envelope)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it('mianxiang derived 通过 schema 校验', () => {
    const validate = validator('mianxiang.derived.schema.json')
    const ok = validate(derived)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it('拒绝置信度低于门槛的 feature', () => {
    const validate = validator(ENVELOPE)
    const bad = {
      ...envelope,
      features: [{ ...envelope.features[0], confidence: 0.2 }],
    }
    expect(validate(bad)).toBe(false)
  })

  it('拒绝 features 中出现 unavailable 状态', () => {
    const validate = validator(ENVELOPE)
    const bad = {
      ...envelope,
      features: [{ ...envelope.features[0], status: 'unavailable' }],
    }
    expect(validate(bad)).toBe(false)
  })
})

describe('分档与置信度', () => {
  const spec = { veryLo: 0.29, lo: 0.31, hi: 0.36, veryHi: 0.38 }

  it('五档边界正确', () => {
    expect(toBand(0.29, spec)).toBe('very_low')
    expect(toBand(0.3, spec)).toBe('low')
    expect(toBand(0.31, spec)).toBe('balanced')
    expect(toBand(0.36, spec)).toBe('balanced')
    expect(toBand(0.37, spec)).toBe('high')
    expect(toBand(0.38, spec)).toBe('very_high')
  })

  it('过盛减分：very_high 权重低于 high', () => {
    expect(BAND_VALUE.very_high).toBeLessThan(BAND_VALUE.high)
    expect(BAND_VALUE.balanced).toBeGreaterThan(BAND_VALUE.low)
  })

  it('低置信度特征被分流到 unavailable', () => {
    const { features, unavailable } = partitionByConfidence([
      { ...envelope.features[0], confidence: 0.9 },
      { ...envelope.features[1], confidence: 0.2 },
    ])
    expect(features).toHaveLength(1)
    expect(unavailable).toHaveLength(1)
    expect(unavailable[0].reason).toBe('low_confidence')
    expect(features[0].confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE)
  })
})

describe('类型注册表', () => {
  it('四种类型齐全且各有必需机位', () => {
    expect(ALL_TYPES).toHaveLength(4)
    for (const t of ALL_TYPES) {
      const s = TYPE_SPECS[t]
      expect(s.shots.some((x) => x.required)).toBe(true)
      expect(s.detectors.length).toBeGreaterThan(0)
      expect(s.classics.length).toBeGreaterThan(0)
    }
  })

  it('骨相需要正面+侧面两张必需照片', () => {
    const gu = TYPE_SPECS.guxiang
    const required = gu.shots.filter((s) => s.required).map((s) => s.kind)
    expect(required).toContain('front')
    expect(required).toContain('profile')
  })
})
