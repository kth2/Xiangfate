/**
 * 组合成象。逐条对应验收标准。
 *
 * 最要紧的一条在最后：**同一个测量值，配不同的邻居，必须能得出不同的象。**
 * 那是这一层存在的全部理由 —— 在它之前，同一个准头档位永远只能得到同一句话。
 */

import { describe, expect, it } from 'vitest'
import {
  configurationBlock,
  detectConfigurations,
  findContradictions,
  renderChain,
  type ConfigurationSpec,
  type DetectedConfiguration,
} from '../configuration'
import { computeScorecard } from '../scorecard'
import { SCORE_DIMENSIONS, type Band, type FeatureItem } from '../types'
import { FACE_CONFIGURATIONS } from '@/modules/mianxiang/configurations'
import { FEATURE_REGISTRY } from '@/modules/mianxiang/features'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/* ============================================================
   夹具
   ============================================================ */

function feat(id: string, band: Band, value: number | string = 0.5, confidence = 0.8): FeatureItem {
  return {
    id,
    category: '鼻',
    // label 刻意不含完整 id —— 真实 label 是「中岳独高度」这类中文术语。
    // 早先写成 `${id} 的术语`，让「组合段不含 face3d.」那条断言误报了一次
    label: id.split('.').pop() ?? id,
    band,
    value,
    status: 'measured',
    confidence,
    evidence: `${id} 实测 ${value}`,
    meaning: '释义',
    source: null,
  }
}

/** 造一组刚好满足某分支全部条件的特征 */
function satisfying(spec: ConfigurationSpec, branchIndex: number): FeatureItem[] {
  const branch = spec.branches[branchIndex]
  const byId = new Map<string, FeatureItem>()
  for (const c of branch.when) {
    const band: Band = c.bands?.[0] ?? 'categorical'
    let value: number = 0.5
    if (c.gte !== undefined && c.lte !== undefined) value = (c.gte + c.lte) / 2
    else if (c.gte !== undefined) value = c.gte
    else if (c.lte !== undefined) value = c.lte
    byId.set(c.featureId, feat(c.featureId, band, value))
  }
  // components 里没被该分支用到的项也要在场，否则会因缺项而不判
  for (const id of spec.components) {
    if (!byId.has(id)) byId.set(id, feat(id, 'balanced', 0.5))
  }
  return [...byId.values()]
}

/* ============================================================
   验收：表本身的规矩
   ============================================================ */

describe('每条组合都写全了', () => {
  it('id 唯一', () => {
    const ids = FACE_CONFIGURATIONS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条都有出处与断法依据 —— 没出处的组合只是「我们希望它这么读」', () => {
    for (const c of FACE_CONFIGURATIONS) {
      expect(c.source, `${c.id} 缺出处`).toBeTruthy()
      expect(c.basis.length, `${c.id} 的 basis 太短，说不清凭什么这么断`).toBeGreaterThan(20)
    }
  })

  it('每个分支都有显式条件，且每条条件都写了人话', () => {
    for (const c of FACE_CONFIGURATIONS) {
      expect(c.branches.length, `${c.id} 没有分支`).toBeGreaterThan(0)
      for (const b of c.branches) {
        expect(b.when.length, `${c.id} / ${b.configuration} 没有条件`).toBeGreaterThan(0)
        for (const w of b.when) {
          // 条件不写人话，证据链就只能说「因为代码说是」
          expect(w.requirement.length, `${c.id} / ${b.configuration} 的条件缺 requirement`).toBeGreaterThan(4)
          const hasTest = w.bands !== undefined || w.gte !== undefined || w.lte !== undefined
          expect(hasTest, `${c.id} / ${b.configuration} 有条件却没有判据`).toBe(true)
        }
      }
      for (const b of c.branches) {
        expect(b.meaning.length, `${c.id} / ${b.configuration} 缺象义`).toBeGreaterThan(10)
      }
    }
  })

  it('条件只引用 components 里声明过的特征', () => {
    for (const c of FACE_CONFIGURATIONS) {
      for (const b of c.branches) {
        for (const w of b.when) {
          expect(c.components, `${c.id} 的条件引用了未声明的 ${w.featureId}`).toContain(w.featureId)
        }
      }
    }
  })

  it('正反两面：每条组合都同时有貴象与忌象，且貴象带反面提醒', () => {
    // 传统相术几乎没有纯吉之象。只出好话的组合表就是另一种失真
    for (const c of FACE_CONFIGURATIONS) {
      const tones = new Set(c.branches.map((b) => b.tone))
      expect(tones.has('ji'), `${c.id} 一个忌象都没有`).toBe(true)
      const gui = c.branches.filter((b) => b.tone === 'gui')
      expect(gui.length, `${c.id} 一个貴象都没有`).toBeGreaterThan(0)
      for (const b of gui) {
        expect(b.caution, `${c.id} / ${b.configuration} 是貴象却没写反面`).toBeTruthy()
      }
    }
  })
})

/* ============================================================
   验收：条件引用的特征真的存在
   ============================================================ */

describe('组合引用的特征都是真的', () => {
  /**
   * 打错一个字的 featureId 不会报错 —— 那条组合只是**永远不命中**，无声无息。
   * 所以直接对着真实来源核对：三维走导出的注册表，二维从 rules 源码里抽 push 的字面量。
   */
  const TWO_D = new Set(
    [
      ...readFileSync(
        fileURLToPath(new URL('../../modules/mianxiang/rules.ts', import.meta.url)),
        'utf8',
      ).matchAll(/push\(\s*\n?\s*'(face\.[A-Za-z0-9_.]*)'/g),
    ].map((m) => m[1]),
  )

  it('两边的来源都不为空，否则这条测试是空转', () => {
    expect(TWO_D.size).toBeGreaterThan(10)
    expect(FEATURE_REGISTRY.size).toBeGreaterThan(10)
  })

  it('每个 component 都能在真实特征里找到', () => {
    const unknown: string[] = []
    for (const c of FACE_CONFIGURATIONS) {
      for (const id of c.components) {
        const real = id.startsWith('face3d.') ? FEATURE_REGISTRY.has(id) : TWO_D.has(id)
        if (!real) unknown.push(`${c.id} → ${id}`)
      }
    }
    expect(unknown, `这些 id 不存在，对应组合永远不会命中：\n  ${unknown.join('\n  ')}`).toEqual([])
  })

  it('不引用只作数值依据的二维项 —— 那些项连单独立论都不许', () => {
    // face.nose.bridge 判线离实测量级 11–52 倍，已列入 evidenceOnly
    for (const c of FACE_CONFIGURATIONS) {
      expect(c.components).not.toContain('face.nose.bridge')
    }
  })
})

/* ============================================================
   验收：分支可达，没有死支
   ============================================================ */

describe('每个分支都能命中', () => {
  it('按分支条件造出来的特征，一定判得出象', () => {
    for (const spec of FACE_CONFIGURATIONS) {
      for (let i = 0; i < spec.branches.length; i++) {
        const r = detectConfigurations(satisfying(spec, i), [spec])
        expect(
          r.detected.length,
          `${spec.id} 的第 ${i} 支（${spec.branches[i].configuration}）造了满足条件的输入却判不出象`,
        ).toBe(1)
      }
    }
  })

  it('没有被前序分支完全遮住的死支', () => {
    // 死支是静态检查抓不到的：条件写得对，但永远轮不到它
    for (const spec of FACE_CONFIGURATIONS) {
      const achieved = new Set<string>()
      for (let i = 0; i < spec.branches.length; i++) {
        const r = detectConfigurations(satisfying(spec, i), [spec])
        if (r.detected[0]) achieved.add(r.detected[0].configuration)
      }
      for (const b of spec.branches) {
        expect(achieved, `${spec.id} / ${b.configuration} 永远轮不到，被前序分支遮住了`).toContain(
          b.configuration,
        )
      }
    }
  })

  it('分支顺序即优先级 —— 命中的绝不会是更靠后的那一支', () => {
    for (const spec of FACE_CONFIGURATIONS) {
      for (let i = 0; i < spec.branches.length; i++) {
        const r = detectConfigurations(satisfying(spec, i), [spec])
        const winner = r.detected[0]?.configuration
        const idx = spec.branches.findIndex((b) => b.configuration === winner)
        expect(idx, `${spec.id} 第 ${i} 支的输入命中了更靠后的第 ${idx} 支`).toBeLessThanOrEqual(i)
      }
    }
  })
})

/* ============================================================
   验收：缺项不判 · 证据链 · 置信度
   ============================================================ */

describe('缺项不判', () => {
  it('所需特征缺一条就不判，并记下原因 —— 不当它成立', () => {
    const spec = FACE_CONFIGURATIONS.find((c) => c.components.length > 1)!
    const partial = satisfying(spec, 0).slice(0, 1)
    const r = detectConfigurations(partial, [spec])
    expect(r.detected).toEqual([])
    expect(r.unmet[0].reason).toBe('missing')
    expect(r.unmet[0].detail).toContain('不论此象')
  })

  it('测到了但不落任何一象时，记为寻常而不是缺失', () => {
    const spec: ConfigurationSpec = {
      id: 'config.test', name: '试', domain: '格局', source: '麻衣神相',
      basis: '仅用于测试的组合，条件刻意造成不可能同时满足',
      components: ['a.x'],
      branches: [{ configuration: '极高', tone: 'gui', when: [{ featureId: 'a.x', gte: 99, requirement: '要求极大' }], meaning: '仅供测试之象义', caution: '仅供测试' }],
    }
    const r = detectConfigurations([feat('a.x', 'balanced', 1)], [spec])
    expect(r.detected).toEqual([])
    expect(r.unmet[0].reason).toBe('no_branch')
  })
})

describe('证据链', () => {
  const spec = FACE_CONFIGURATIONS.find((c) => c.id === 'config.face.wealthBearing')!

  it('每一象都带链，链上每一环都对得上一条真实特征', () => {
    const features = satisfying(spec, 0)
    const d = detectConfigurations(features, [spec]).detected[0]
    expect(d.chain.length).toBe(spec.branches[0].when.length)
    for (const l of d.chain) {
      expect(features.some((f) => f.id === l.featureId)).toBe(true)
      expect(l.requirement).toBeTruthy()
      expect(l.evidence).toBeTruthy()
    }
  })

  it('置信度取最弱一环，不取均值', () => {
    const features = satisfying(spec, 0).map((f, i) =>
      i === 0 ? { ...f, confidence: 0.4 } : { ...f, confidence: 0.95 },
    )
    const d = detectConfigurations(features, [spec]).detected[0]
    // 一条链不会比它最不确定的那一环更可信
    expect(d.confidence).toBe(0.4)
  })

  it('同一组输入每次给同一组象 —— 与星级、提纲同一个原则', () => {
    const features = satisfying(spec, 0)
    const a = detectConfigurations(features, FACE_CONFIGURATIONS)
    for (let i = 0; i < 3; i++) {
      expect(detectConfigurations(features, FACE_CONFIGURATIONS)).toEqual(a)
    }
  })
})

/* ============================================================
   验收：原始三维数值不可引用
   ============================================================ */

describe('三维数值不进模型', () => {
  // 三庭全部由三维项判定，用它测「3D 环节不给数字」
  const spec = FACE_CONFIGURATIONS.find((c) => c.id === 'config.face.threeCourts')!

  it('证据链渲染时，三维环节只给定性要求，不给数字', () => {
    const d = detectConfigurations(satisfying(spec, 0), [spec]).detected[0]
    const lines = renderChain(d.chain)
    for (const line of lines) {
      if (line.includes('三维推导')) {
        expect(line).toContain('此处不列数值')
        // 该行不得残留实测数字
        expect(line).not.toMatch(/实测/)
      }
    }
  })

  it('三维环节被标记出来，不靠名字碰运气', () => {
    const d = detectConfigurations(satisfying(spec, 0), [spec]).detected[0]
    const threeD = d.chain.filter((l) => l.featureId.startsWith('face3d.'))
    expect(threeD.length).toBeGreaterThan(0)
    for (const l of threeD) expect(l.numeralRestricted).toBe(true)
  })

  it('同一条链上：二维环节带数值，三维环节不带 —— 区分是结构性的', () => {
    // 财帛承载正好是混合链：准头/鼻翼/山根是二维，鼻翼张度是三维
    const mixed = FACE_CONFIGURATIONS.find((c) => c.id === 'config.face.wealthBearing')!
    const d = detectConfigurations(satisfying(mixed, 0), [mixed]).detected[0]
    const lines = renderChain(d.chain)

    const twoD = d.chain.filter((l) => !l.numeralRestricted)
    const threeD = d.chain.filter((l) => l.numeralRestricted)
    expect(twoD.length, '这条链上应当有二维环节').toBeGreaterThan(0)
    expect(threeD.length, '这条链上应当有三维环节').toBeGreaterThan(0)

    // 二维环节把自己的实测串带进去了
    for (const l of twoD) {
      expect(lines.some((line) => line.includes(l.evidence))).toBe(true)
    }
    // 三维环节一个数字都没带
    for (const l of threeD) {
      expect(lines.some((line) => line.includes(l.evidence))).toBe(false)
    }
  })

  it('组合段整体不含任何 face3d 的原始数值', () => {
    const r = detectConfigurations(satisfying(spec, 0), FACE_CONFIGURATIONS)
    const block = configurationBlock(r)
    expect(block).not.toContain('face3d.')
    for (const d of r.detected) {
      for (const l of d.chain) {
        if (l.numeralRestricted) expect(block).not.toContain(l.evidence)
      }
    }
  })
})

/* ============================================================
   验收：矛盾保留，不合并
   ============================================================ */

describe('并见的张力', () => {
  const mk = (domain: DetectedConfiguration['domain'], configuration: string, tone: 'gui' | 'ji') =>
    ({
      id: `config.${configuration}`, name: configuration, domain, configuration, tone,
      meaning: '象义', source: '麻衣神相' as const, basis: '基', confidence: 0.8, chain: [],
    }) as DetectedConfiguration

  it('同域一貴一忌，两者都留下，并记一条张力', () => {
    const cs = findContradictions([mk('财帛', '财有所承', 'gui'), mk('财帛', '取之有能而守之不足', 'ji')])
    expect(cs).toHaveLength(1)
    expect(cs[0].domain).toBe('财帛')
    expect(cs[0].between).toEqual(['财有所承', '取之有能而守之不足'])
    expect(cs[0].tension).toContain('不可相抵')
  })

  it('跨域的强弱不同不算矛盾 —— 那是侧重，不是打架', () => {
    expect(findContradictions([mk('财帛', 'A', 'gui'), mk('情感', 'B', 'ji')])).toEqual([])
  })

  it('同域同向不算矛盾', () => {
    expect(findContradictions([mk('财帛', 'A', 'gui'), mk('财帛', 'B', 'gui')])).toEqual([])
  })

  it('矛盾不会把任何一象从 detected 里剔掉', () => {
    // 星级卡的毛病正是把张力平均掉；这里必须两边都在
    const detected = [mk('财帛', '财有所承', 'gui'), mk('财帛', '取之有能而守之不足', 'ji')]
    const cs = findContradictions(detected)
    expect(detected).toHaveLength(2)
    expect(cs).toHaveLength(1)
  })

  it('组合段会把张力写出来并要求两边都讲', () => {
    const block = configurationBlock({
      detected: [mk('财帛', '财有所承', 'gui'), mk('财帛', '取之有能而守之不足', 'ji')],
      unmet: [],
      contradictions: findContradictions([mk('财帛', '财有所承', 'gui'), mk('财帛', '取之有能而守之不足', 'ji')]),
    })
    expect(block).toContain('并见的张力')
    expect(block).toContain('不要为了让报告顺畅而把它们平均掉')
  })
})

/* ============================================================
   验收：不影响星级
   ============================================================ */

describe('组合不参与星级', () => {
  it('detectConfigurations 判出多少象，星级一个不动', () => {
    const spec = FACE_CONFIGURATIONS.find((c) => c.id === 'config.face.wealthBearing')!
    const features = satisfying(spec, 0)
    const before = computeScorecard(features)
    const r = detectConfigurations(features, FACE_CONFIGURATIONS)
    expect(r.detected.length).toBeGreaterThan(0)
    const after = computeScorecard(features)
    expect(after).toEqual(before)
  })

  it('星级只认 features —— 组合结果压根不是它的入参', () => {
    // 类型上就传不进去；这里守的是「将来别人别给它加一个可选参数」
    expect(computeScorecard.length).toBe(1)
  })

  it('组合里的三维项照旧不进星级', () => {
    const withThreeD = [feat('face3d.wuYue.support', 'categorical', 0.9), feat('face.nose.root', 'high')]
    const without = [feat('face.nose.root', 'high')]
    expect(computeScorecard(withThreeD)).toEqual(computeScorecard(without))
  })
})

/* ============================================================
   验收（核心）：同一个测量值 + 不同邻居 = 不同的象
   ============================================================ */

describe('同一个准头，配不同的邻居，读出相反的象', () => {
  const spec = FACE_CONFIGURATIONS.find((c) => c.id === 'config.face.wealthBearing')!

  /** 准头一律 high —— 两组的这一项**完全相同** */
  const 准头 = () => feat('face.palace.caibo', 'high', 0.72)

  const 甲 = [
    准头(),
    feat('face.nose.alar', 'balanced', 0.41),
    feat('face3d.nose.alarFlare', 'categorical', 0.7), // 鼻翼有收
    feat('face.nose.root', 'balanced', 0.52), // 山根连续
  ]
  const 乙 = [
    准头(),
    feat('face.nose.alar', 'balanced', 0.41),
    feat('face3d.nose.alarFlare', 'categorical', 0.95), // 鼻翼过张
    feat('face.nose.root', 'balanced', 0.52),
  ]

  it('两组的准头是同一条特征、同一档位、同一数值', () => {
    const a = 甲.find((f) => f.id === 'face.palace.caibo')!
    const b = 乙.find((f) => f.id === 'face.palace.caibo')!
    expect(a.band).toBe(b.band)
    expect(a.value).toBe(b.value)
    expect(a).toEqual(b)
  })

  it('只有鼻翼张度不同 —— 其余三项完全一致', () => {
    const diff = 甲.filter((f, i) => JSON.stringify(f) !== JSON.stringify(乙[i]))
    expect(diff.map((f) => f.id)).toEqual(['face3d.nose.alarFlare'])
  })

  it('却读出方向相反的两个象', () => {
    const a = detectConfigurations(甲, [spec]).detected[0]
    const b = detectConfigurations(乙, [spec]).detected[0]

    expect(a.configuration).toBe('财有所承')
    expect(a.tone).toBe('gui')
    expect(b.configuration).toBe('取之有能而守之不足')
    expect(b.tone).toBe('ji')
    expect(a.meaning).not.toBe(b.meaning)
  })

  it('这正是单特征规则做不到的事 —— 旧路径下两组给的是同一句话', () => {
    // verdicts 与 scorecard 都按单条特征立论，因此对这两组必然一致
    const aScore = computeScorecard(甲)
    const bScore = computeScorecard(乙)
    for (const dim of SCORE_DIMENSIONS) expect(aScore[dim]).toBe(bScore[dim])
  })

  it('山根低陷也能翻转同一个准头的象', () => {
    const 丙 = [准头(), feat('face.nose.alar', 'balanced', 0.41), feat('face3d.nose.alarFlare', 'categorical', 0.7), feat('face.nose.root', 'low', 0.3)]
    const c = detectConfigurations(丙, [spec]).detected[0]
    expect(c.configuration).toBe('取而无根')
    expect(c.tone).toBe('ji')
  })
})
