/**
 * 提纲是「骨架也按人算」的落点，它错了整份报告就回到千人一面。
 * 这里盯三件事：确定性、随测到的东西变、关注方向真的起作用。
 */

import { describe, expect, it } from 'vitest'
import { buildOutline, CORE_CLOSING, CORE_OPENING, rankSalience, TOPIC_POOL } from '../outline'
import { ALLOWED_SECTIONS, SECTION_COUNT } from '../guard.rules'
import type { Band, FeatureItem } from '../types'

function feat(id: string, band: Band, confidence = 0.9): FeatureItem {
  return {
    id,
    category: '三停',
    label: `${id} 的术语`,
    band,
    value: 1,
    status: 'measured',
    confidence,
    evidence: `${id} 的证据`,
    meaning: `${id} 的释义`,
    source: null,
  }
}

describe('显著度排序', () => {
  it('偏离越远、置信度越高，排得越前', () => {
    const ranked = rankSalience([
      feat('face.mouth.lip', 'balanced'),
      feat('face.nose.alar', 'very_high'),
      feat('face.brow.length', 'high'),
    ])
    expect(ranked.map((r) => r.id)).toEqual([
      'face.nose.alar',
      'face.brow.length',
      'face.mouth.lip',
    ])
  })

  it('同档位时置信度低的排后面', () => {
    const ranked = rankSalience([
      feat('face.nose.alar', 'very_high', 0.4),
      feat('face.palace.caibo', 'very_high', 0.95),
    ])
    expect(ranked[0].id).toBe('face.palace.caibo')
  })

  it('只作数值依据的项不参与 —— 它连判断都不下，不该决定报告写什么', () => {
    const ranked = rankSalience([
      feat('face.nose.bridge', 'very_high'),
      feat('face3d.nose.rootDepth', 'very_high'),
      feat('face.mouth.lip', 'balanced'),
    ])
    expect(ranked.map((r) => r.id)).toEqual(['face.mouth.lip'])
  })
})

describe('提纲', () => {
  const relationFeatures = [
    feat('face.mouth.corner', 'very_high'),
    feat('face.mouth.lip', 'very_low'),
    feat('face.brow.length', 'high'),
  ]
  const wealthFeatures = [
    feat('face.palace.caibo', 'very_high'),
    feat('face.nose.alar', 'very_high'),
    feat('face.mouth.philtrum', 'low'),
  ]

  it('同一组特征每次给同一份提纲 —— 与星级同一个原则', () => {
    const a = buildOutline(relationFeatures)
    const b = buildOutline(relationFeatures)
    expect(a.sections).toEqual(b.sections)
  })

  it('核心段永远在，且首尾位置固定', () => {
    const o = buildOutline(relationFeatures)
    expect(o.sections.slice(0, CORE_OPENING.length)).toEqual([...CORE_OPENING])
    expect(o.sections.slice(-CORE_CLOSING.length)).toEqual([...CORE_CLOSING])
  })

  it('测到的东西不同，入选的专题段就不同', () => {
    const rel = buildOutline(relationFeatures).sections
    const wea = buildOutline(wealthFeatures).sections
    expect(rel).not.toEqual(wea)
    expect(rel).toContain('情感与人际')
    expect(wea).toContain('财帛与积累')
  })

  it('关注方向能把对应专题拉进提纲并靠前', () => {
    const mixed = [...relationFeatures, ...wealthFeatures]
    const plain = buildOutline(mixed)
    const focused = buildOutline(mixed, ['想问财运'])
    expect(focused.sections).toContain('财帛与积累')
    // 加权后财帛应当排在关系之前
    const iw = focused.sections.indexOf('财帛与积累')
    const ir = focused.sections.indexOf('情感与人际')
    expect(iw).toBeLessThan(ir)
    expect(focused.scores[0][0]).not.toBe(plain.scores[0][0])
  })

  it('关注方向不能凭空造段 —— 没有特征支撑就不入选', () => {
    // 只有情感类特征，却关注财运
    const o = buildOutline(relationFeatures, ['财运'])
    expect(o.sections).not.toContain('财帛与积累')
  })

  it('段数始终落在 guard 认可的范围内', () => {
    const cases = [relationFeatures, wealthFeatures, [...relationFeatures, ...wealthFeatures], []]
    for (const fs of cases) {
      const o = buildOutline(fs)
      expect(o.sections.length).toBeGreaterThanOrEqual(SECTION_COUNT.min)
      expect(o.sections.length).toBeLessThanOrEqual(SECTION_COUNT.max)
    }
  })

  it('提纲里的每个标题都在 guard 白名单内 —— 否则模型照写也会被剔掉', () => {
    const o = buildOutline([...relationFeatures, ...wealthFeatures])
    for (const sec of o.sections) {
      expect(ALLOWED_SECTIONS as readonly string[]).toContain(sec)
    }
  })

  it('一条特征都没有时也给得出合法提纲', () => {
    const o = buildOutline([])
    expect(o.sections).toEqual([...CORE_OPENING, ...CORE_CLOSING])
    expect(o.topics).toEqual([])
  })

  it('专题池里每个专题的 feeds 都非空，且写作要点不为空', () => {
    for (const t of TOPIC_POOL) {
      expect(t.feeds.length).toBeGreaterThan(0)
      expect(t.brief.length).toBeGreaterThan(10)
      expect(t.focusWords.length).toBeGreaterThan(0)
    }
  })
})
