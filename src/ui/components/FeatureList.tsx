import { useMemo, useState } from 'react'
import { BAND_LABEL, STATUS_LABEL } from '@/core/band'
import type { FeatureItem, UnavailableItem } from '@/core/types'

const REASON_LABEL: Record<UnavailableItem['reason'], string> = {
  not_observable: '照片拍不到',
  not_captured: '本次未采集',
  low_confidence: '置信度不足',
  out_of_scope: '超出可测范围',
}

/**
 * 测得的特征 + 测不到的项。
 * 「未观测」那一栏是刻意显眼的 —— 让用户看到我们的边界在哪，
 * 而不是只展示好看的部分。
 */
export function FeatureList({
  features,
  unavailable,
  accent,
}: {
  features: FeatureItem[]
  unavailable: UnavailableItem[]
  accent: string
}) {
  const [open, setOpen] = useState(false)

  const grouped = useMemo(() => {
    const g = new Map<string, FeatureItem[]>()
    for (const f of features) {
      const arr = g.get(f.category) ?? []
      arr.push(f)
      g.set(f.category, arr)
    }
    return [...g.entries()]
  }, [features])

  return (
    <section className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div>
          <h2 className="font-title text-sm tracking-[0.2em]">实测特征</h2>
          <p className="mt-1 text-[11px] text-subtle">
            测得 {features.length} 项，未观测 {unavailable.length} 项
          </p>
        </div>
        <span className="font-title text-[13px] text-muted">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="border-t px-4 pt-4 pb-5" style={{ borderColor: 'var(--line)' }}>
          {grouped.map(([category, items]) => (
            <div key={category} className="mb-5 last:mb-0">
              <p className="mb-2 text-[11px] tracking-[0.2em] text-subtle">{category}</p>
              <ul className="flex flex-col gap-3">
                {items.map((f) => (
                  <li key={f.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="font-title text-[14px]" style={{ color: accent }}>
                        {f.label}
                      </span>
                      <span className="text-[11px] text-subtle">
                        {STATUS_LABEL[f.status]}
                        {f.band !== 'categorical' && ` · ${BAND_LABEL[f.band]}`}
                        {' · '}
                        可信度 {Math.round(f.confidence * 100)}%
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-muted">{f.evidence}</p>
                    {f.source && <p className="mt-0.5 text-[11px] text-subtle">《{f.source}》</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {unavailable.length > 0 && (
            <div
              className="mt-6 border-t pt-4"
              style={{ borderColor: 'var(--line)' }}
            >
              <p className="mb-1 text-[11px] tracking-[0.2em] text-subtle">未观测</p>
              <p className="mb-3 text-[11px] leading-relaxed text-subtle">
                以下项目本次拿不到数据。报告里不会对它们下任何判断。
              </p>
              <ul className="flex flex-col gap-2">
                {unavailable.map((u) => (
                  <li key={u.id}>
                    <span className="text-[13px] text-muted">{u.label}</span>
                    <span className="ml-2 text-[11px] text-subtle">
                      {REASON_LABEL[u.reason]}
                    </span>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-subtle">{u.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
