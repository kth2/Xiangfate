/**
 * 断语层的测试。
 *
 * 这一层的价值全在「不许多、不许少」：断语只能由已测特征查表得出。
 * 模型可以把断语讲得好听或难听，但**有没有这条断语**不该由它决定。
 */

import { describe, expect, it } from 'vitest'
import { collectVerdicts, verdictBlock } from '../verdicts'
import type { FeatureItem } from '../types'

function feat(partial: Partial<FeatureItem> & { label: string }): FeatureItem {
  return {
    id: partial.id ?? `face.test.${partial.label}`,
    category: partial.category ?? '眼',
    label: partial.label,
    band: partial.band ?? 'balanced',
    value: partial.value ?? 0,
    status: partial.status ?? 'measured',
    confidence: partial.confidence ?? 0.8,
    evidence: partial.evidence ?? '测试用',
    meaning: partial.meaning ?? '测试用',
    source: partial.source ?? null,
  } as FeatureItem
}

describe('断语提取', () => {
  it('命中的忌相与贵格都能查出来', () => {
    const vs = collectVerdicts([
      feat({ label: '三白眼', id: 'face.eye.sclera' }),
      feat({ label: '三停平均', id: 'face.threeCourts.balance' }),
    ])
    expect(vs.map((v) => v.name)).toEqual(['三白眼', '三停平均'])
    expect(vs[0].tone).toBe('ji')
    expect(vs[1].tone).toBe('gui')
  })

  it('忌相排在贵格前面 —— 这是最容易被糊过去的部分', () => {
    const vs = collectVerdicts([
      feat({ label: '天庭饱满' }),
      feat({ label: '人中浅短' }),
      feat({ label: '口阔' }),
      feat({ label: '唇薄' }),
    ])
    expect(vs.slice(0, 2).every((v) => v.tone === 'ji')).toBe(true)
  })

  it('表里没有的 label 不产生断语', () => {
    expect(collectVerdicts([feat({ label: '五眼匀称' }), feat({ label: '眉浓淡适中' })])).toEqual([])
  })

  it('痣按位置各出一条断语，用规则给的原文', () => {
    // 规则层按位置分列（face.mole.<slug>），因此一张脸上两处痣就是两条断语 ——
    // 术士当面看相也是逐处点名，不会把它们并成一句。
    const vs = collectVerdicts([
      feat({
        id: 'face.mole.yintang',
        label: '印堂见痣',
        meaning: '印堂见痣，传统主运途多阻、心事难解',
        status: 'inferred',
      }),
      feat({
        id: 'face.mole.quan',
        label: '颧见痣',
        meaning: '颧上见痣，传统主权柄受挫、是非缠身',
        status: 'inferred',
      }),
    ])
    expect(vs).toHaveLength(2)
    expect(vs.every((v) => v.tone === 'ji')).toBe(true)
    expect(vs.every((v) => v.inferred)).toBe(true)
    expect(vs.map((v) => v.text).join('')).toContain('运途多阻')
    expect(vs.map((v) => v.text).join('')).toContain('是非缠身')
    // featureId 要能回溯到具体位置，而不是笼统的 face.mole
    expect(vs.map((v) => v.featureId).sort()).toEqual(['face.mole.quan', 'face.mole.yintang'])
  })

  it('「面上无显痣」不是断语', () => {
    expect(collectVerdicts([feat({ id: 'face.mole.none', label: '面上无显痣' })])).toEqual([])
  })

  it('推估项被标出来，展开时要带一句', () => {
    const [v] = collectVerdicts([feat({ label: '山根偏平', status: 'inferred' })])
    expect(v.inferred).toBe(true)
  })
})

describe('注入 prompt 的断语块', () => {
  it('列出每一条，并禁止增补', () => {
    const block = verdictBlock(
      [feat({ label: '三白眼' }), feat({ label: '法令过口' })],
      'mianxiang',
    )
    expect(block).toContain('三白眼')
    expect(block).toContain('螣蛇入口')
    expect(block).toContain('不要增补')
  })

  it('一条都没命中时，明说没有，而不是留给模型自由发挥', () => {
    const block = verdictBlock([feat({ label: '五眼匀称' })], 'mianxiang')
    expect(block).toContain('未见明显吉格与忌处')
    expect(block).toContain('不要**自己造')
  })

  it('骨相额外提醒通篇按推估措辞', () => {
    expect(verdictBlock([feat({ label: '骨露少肉' })], 'guxiang')).toContain('推估措辞')
    expect(verdictBlock([feat({ label: '骨露少肉' })], 'mianxiang')).not.toContain('推估措辞')
  })
})
