import { useMemo } from 'react'
import { collectVerdicts } from '@/core/verdicts'
import type { FeatureItem } from '@/core/types'

/**
 * 断语卡。
 *
 * 这一栏**不经过 AI** —— 由 core/verdicts.ts 从已测特征查表算出，
 * 和报告正文里那段断语是同一份来源。模型若漏写或多写，这里仍是准的。
 */
export function VerdictList({ features, accent }: { features: FeatureItem[]; accent: string }) {
  const verdicts = useMemo(() => collectVerdicts(features), [features])

  if (!verdicts.length) {
    return (
      <section className="card p-4">
        <h2 className="font-title mb-3 text-sm tracking-[0.2em]">断语</h2>
        <p className="text-[12px] leading-relaxed text-muted">
          本次测到的各项都落在中和区间，未见有名目的吉格或忌处。
        </p>
      </section>
    )
  }

  const ji = verdicts.filter((v) => v.tone === 'ji')
  const gui = verdicts.filter((v) => v.tone === 'gui')

  return (
    <section className="card p-4">
      <h2 className="font-title mb-1 text-sm tracking-[0.2em]">断语</h2>
      <p className="mb-4 text-[11px] text-subtle">
        由本次测得的特征查传统相法得出，未经 AI 改写
      </p>

      {gui.length > 0 && <Group items={gui} tag="贵" color={accent} />}
      {ji.length > 0 && (
        <Group items={ji} tag="忌" color="var(--color-cinnabar-500)" className={gui.length ? 'mt-4' : ''} />
      )}
    </section>
  )
}

function Group({
  items,
  tag,
  color,
  className = '',
}: {
  items: ReturnType<typeof collectVerdicts>
  tag: string
  color: string
  className?: string
}) {
  return (
    <div className={className}>
      {items.map((v) => (
        <div key={`${v.featureId}-${v.name}`} className="mb-3 flex gap-2.5 last:mb-0">
          <span
            aria-hidden
            className="mt-[3px] shrink-0 border px-1 text-[10px] leading-[14px]"
            style={{ borderColor: color, color, borderRadius: 2 }}
          >
            {tag}
          </span>
          <div className="min-w-0">
            <p className="text-[13px]" style={{ color }}>
              {v.name}
              {v.inferred && <span className="ml-1.5 text-[10px] text-subtle">推估</span>}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{v.text}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
