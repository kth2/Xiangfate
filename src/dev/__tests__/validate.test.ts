/**
 * 验证台自身的测试 —— 外加**今天就能跑**的那一半结论。
 *
 * 姿态鲁棒性不需要任何真实照片：合成旋转同一组关键点即可。
 * 所以这个文件顺带就是 Phase 0 / Phase 1 的第一份对比结果，
 * 而且它进 CI —— 以后谁改了规范帧，这里会立刻显形。
 */

import { describe, expect, it } from 'vitest'
import {
  buildReport,
  DEFAULT_ANGLES,
  EXPORT_VERSION,
  formatReport,
  PAIRS,
  phase0Metrics,
  phase1Metrics,
  poseRobustness,
  rotateSample,
  spreadOf,
  type ExportBundle,
  type LandmarkSample,
} from '../validate'
import { IMG_H, IMG_W, projectCanonical } from '@/modules/mianxiang/__tests__/canonical'

const sample: LandmarkSample = {
  shotId: 'canonical',
  subjectId: 'canonical',
  label: '规范脸',
  landmarks: projectCanonical(),
  imgWidth: IMG_W,
  imgHeight: IMG_H,
}

describe('统计工具', () => {
  it('离散度用 MAD，不被离群值带偏', () => {
    const s = spreadOf('t', [1, 1.02, 0.98, 1.01, 9])
    expect(s.median).toBeCloseTo(1.01, 2)
    expect(s.mad).toBeLessThan(0.05)
    expect(s.maxDev).toBeGreaterThan(7)
  })

  it('接近 0 的量用地板值兜底，相对离散不会炸', () => {
    const s = spreadOf('t', [0.0001, -0.0002, 0])
    expect(Number.isFinite(s.relative)).toBe(true)
    expect(s.relative).toBeLessThan(1)
  })

  it('空输入不抛错', () => {
    expect(() => spreadOf('t', [])).not.toThrow()
  })
})

describe('旋转', () => {
  it('0° 等于原样', () => {
    const r = rotateSample(sample, {})
    for (let i = 0; i < sample.landmarks.length; i += 37) {
      expect(r.landmarks[i].x).toBeCloseTo(sample.landmarks[i].x, 9)
      expect(r.landmarks[i].z).toBeCloseTo(sample.landmarks[i].z, 9)
    }
  })

  it('确实动了点云', () => {
    const r = rotateSample(sample, { yaw: 10 })
    const moved = r.landmarks.some((p, i) => Math.abs(p.x - sample.landmarks[i].x) > 1e-4)
    expect(moved).toBe(true)
  })
})

/**
 * ⚠️ 这一组就是结论本身。
 * 断言写的是「Phase 1 在这些项上必须不比 Phase 0 差」——
 * 若哪天规范帧改坏了，这里会挂。
 */
describe('轴一 · 姿态鲁棒性（合成旋转，零样本）', () => {
  const p0 = new Map(poseRobustness(sample, phase0Metrics).map((d) => [d.metric, d]))
  const p1 = new Map(poseRobustness(sample, phase1Metrics).map((d) => [d.metric, d]))

  it.each(PAIRS)('%s → %s：Phase 1 不差于 Phase 0', (a, b) => {
    const x = p0.get(a)!
    const y = p1.get(b)!
    expect(x, `Phase 0 缺 ${a}`).toBeDefined()
    expect(y, `Phase 1 缺 ${b}`).toBeDefined()
    // 留 1pp 容差：两代的量纲不同，不追求逐项碾压，只要求不倒退
    expect(y.relative, `${a}=${x.relative} → ${b}=${y.relative}`).toBeLessThanOrEqual(x.relative + 0.01)
  })

  it('三停在 ±3° 内几乎不动 —— 这是最常被引用的一组数', () => {
    const small = poseRobustness(sample, phase1Metrics, [{ yaw: 3 }, { pitch: 3 }, { roll: 3 }])
    for (const id of [
      'face3d.threeCourts.upper',
      'face3d.threeCourts.middle',
      'face3d.threeCourts.lower',
    ]) {
      expect(small.find((d) => d.metric === id)!.relative, id).toBeLessThan(0.02)
    }
  })

  it('对称度不因为转头而下降 —— 转头不是不对称', () => {
    const base = phase1Metrics(sample)['face3d.symmetry.score']
    for (const a of DEFAULT_ANGLES) {
      const v = phase1Metrics(rotateSample(sample, a))['face3d.symmetry.score']
      expect(v, JSON.stringify(a)).toBeGreaterThan(base - 0.05)
    }
  })
})

describe('报告', () => {
  const bundle: ExportBundle = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    samples: [sample],
  }

  it('单样本也能出报告，并如实说明缺哪两条轴', () => {
    const r = buildReport(bundle)
    expect(r.sampleCount).toBe(1)
    expect(r.pose.pairs.length).toBe(PAIRS.length)
    expect(r.jitter).toBeNull()
    expect(r.crossShot).toBeNull()

    const md = formatReport(r)
    expect(md).toContain('轴一 · 姿态鲁棒性')
    expect(md).toContain('没有同一 shotId 的多帧样本')
    expect(md).toContain('没有同一 subjectId 的多张照片')
  })

  it('多帧样本会触发轴二', () => {
    const r = buildReport({
      ...bundle,
      samples: [sample, { ...rotateSample(sample, { yaw: 1 }), shotId: 'canonical' }],
    })
    expect(r.jitter).not.toBeNull()
    expect(r.jitter!.phase1.length).toBeGreaterThan(10)
  })

  it('同一人的多张照片会触发轴三', () => {
    const r = buildReport({
      ...bundle,
      samples: [
        sample,
        { ...rotateSample(sample, { yaw: 4 }), shotId: 'b', subjectId: 'canonical' },
        { ...rotateSample(sample, { pitch: 3 }), shotId: 'c', subjectId: 'canonical' },
      ],
    })
    expect(r.crossShot).not.toBeNull()
  })

  it('空样本直接报错，而不是给一份看起来正常的空报告', () => {
    expect(() => buildReport({ ...bundle, samples: [] })).toThrow()
  })

  it('报告里两代并排，且给出结论列', () => {
    const md = formatReport(buildReport(bundle))
    expect(md).toContain('Phase 0')
    expect(md).toContain('Phase 1')
    expect(md).toMatch(/✅ 更稳|≈ 持平|⚠️ 更差/)
  })

  /**
   * 合成旋转下 Phase 1 归零是恒等式而非实测 —— 报告必须自己说清楚，
   * 否则读表的人会直接得出「Phase 1 完美」的错误结论。
   */
  it('报告自带警告，说明轴一证明不了真实鲁棒性', () => {
    const md = formatReport(buildReport(bundle))
    expect(md).toContain('证明不了')
    expect(md).toContain('恒等式')
    expect(md).toContain('轴二、轴三')
  })
})
