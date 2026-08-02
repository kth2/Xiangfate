import { useMemo, useState } from 'react'
import { DIMENSION_MEANING, explainScorecard, type DimensionDriver } from '@/core/scorecard'
import { SCORE_DIMENSIONS, type FeatureItem, type Scorecard } from '@/core/types'
import { SCORECARD_NOTE } from '@/copy/disclaimer.zh-CN'

const DIRECTION_LABEL: Record<DimensionDriver['direction'], string> = {
  up: '助',
  down: '损',
  // 过盛反损 —— 传统相术「过犹不及」，分值确实低于 high，但不是「测得差」
  excess: '过',
}

/**
 * 星级由本地规则算出，不经 AI —— 同一张照片每次都一样。
 * 展开后给出每一维的来由：哪几条相理把它推上去或拉下来。
 * 这些理由与星级出自同一张权重表，不是事后补的说明。
 */
export function ScoreCardView({
  scorecard,
  features,
  accent,
}: {
  scorecard: Scorecard
  features: FeatureItem[]
  accent: string
}) {
  const [openDim, setOpenDim] = useState<string | null>(null)
  const explain = useMemo(() => explainScorecard(features), [features])

  return (
    <section className="card p-4">
      <h2 className="font-title mb-1 text-sm tracking-[0.2em]">五维气象</h2>
      <p className="mb-4 text-[11px] text-subtle">点开任一维，看它是由哪几条相理算出来的</p>

      <ul className="flex flex-col">
        {SCORE_DIMENSIONS.map((dim) => {
          const e = explain[dim]
          const open = openDim === dim
          return (
            <li key={dim} className="border-b last:border-b-0" style={{ borderColor: 'var(--line)' }}>
              <button
                type="button"
                onClick={() => setOpenDim(open ? null : dim)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 py-3 text-left"
              >
                <span className="font-title w-20 shrink-0 text-[13px] tracking-[0.05em]">{dim}</span>
                <span className="flex gap-1" aria-label={`${dim} ${scorecard[dim]} 星`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span
                      key={n}
                      aria-hidden
                      className="h-1.5 w-6 rounded-full transition-colors"
                      style={{
                        background: n <= scorecard[dim] ? accent : 'var(--line)',
                        opacity: n <= scorecard[dim] ? 0.9 : 1,
                      }}
                    />
                  ))}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-subtle">
                  {open ? '收起' : '何以'}
                </span>
              </button>

              {open && (
                <div className="pb-4 pl-1">
                  {/* 这一维在传统相术里主什么 —— 先说范畴，再说相理 */}
                  <p className="mb-1.5 text-[11px] tracking-[0.1em] text-subtle">
                    {DIMENSION_MEANING[dim].brief} · 传统对应{DIMENSION_MEANING[dim].scope}
                  </p>
                  <p
                    className="mb-4 border-l-2 py-1 pl-3 text-[12px] leading-relaxed text-muted"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    {DIMENSION_MEANING[dim].traditional}
                    <span className="ml-1 text-[11px] text-subtle">
                      《{DIMENSION_MEANING[dim].source}》
                    </span>
                  </p>

                  {e.neutralFallback ? (
                    // 不写死「3 星」：星条渲染的是随记录一起存下来的分值，
                    // 万一权重表在版本间变过，写死数字就会和眼前的星条打架
                    <p className="text-[12px] leading-relaxed text-muted">
                      这一维本次没有测到足够的特征，星级取的是中性值 —— 是「没看到」，不是「不好」。
                    </p>
                  ) : e.drivers.length === 0 ? (
                    <p className="text-[12px] leading-relaxed text-muted">
                      参与计算的 {e.count} 项都落在中和区间，没有明显推高或拉低的项，故为中评。
                    </p>
                  ) : (
                    <>
                      <ul className="flex flex-col gap-2.5">
                        {e.drivers.map((d) => (
                          <li key={d.id} className="flex gap-2">
                            <span
                              className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center text-[10px]"
                              style={{
                                border: `1px solid ${d.direction === 'up' ? accent : 'var(--line)'}`,
                                color: d.direction === 'up' ? accent : 'var(--fg-muted)',
                                borderRadius: 2,
                              }}
                              title={
                                d.direction === 'up'
                                  ? '推高'
                                  : d.direction === 'excess'
                                    ? '过盛反损'
                                    : '拉低'
                              }
                            >
                              {DIRECTION_LABEL[d.direction]}
                            </span>
                            <span className="min-w-0">
                              <span className="text-[13px]" style={{ color: accent }}>
                                {d.label}
                              </span>
                              {d.source && (
                                <span className="ml-1.5 text-[11px] text-subtle">《{d.source}》</span>
                              )}
                              <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                                {d.meaning}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 text-[11px] text-subtle">
                        共 {e.count} 项参与计算，上面是影响最大的几条
                      </p>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="mt-4 text-[11px] leading-relaxed text-subtle">{SCORECARD_NOTE}</p>
    </section>
  )
}
