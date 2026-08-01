import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ALL_TYPES, TYPE_SPECS } from '@/core/registry'
import { deleteRecord, listRecords, type HistoryRecord } from '@/db/idb'
import type { AnalysisType } from '@/core/types'
import { SHORT_DISCLAIMER } from '@/copy/disclaimer.zh-CN'
import { TypeGlyph } from '../components/TypeGlyph'

export function History() {
  const [records, setRecords] = useState<HistoryRecord[] | null>(null)
  const [filter, setFilter] = useState<AnalysisType | null>(null)

  useEffect(() => {
    let alive = true
    void listRecords(filter ?? undefined).then((r) => {
      if (alive) setRecords(r)
    })
    return () => {
      alive = false
    }
  }, [filter])

  async function onDelete(id: string) {
    if (!confirm('删除这条记录？')) return
    await deleteRecord(id)
    setRecords((r) => r?.filter((x) => x.id !== id) ?? null)
  }

  return (
    <div className="page px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-title text-[13px] tracking-[0.1em] text-muted">
          ← 返回
        </Link>
        <h1 className="font-title text-base tracking-[0.25em]">往迹</h1>
        <span className="w-12" />
      </div>

      <div className="rule-gold my-6" />

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        <FilterChip active={filter === null} onClick={() => setFilter(null)} label="全部" />
        {ALL_TYPES.map((t) => (
          <FilterChip
            key={t}
            active={filter === t}
            onClick={() => setFilter(t)}
            label={TYPE_SPECS[t].name}
            accent={TYPE_SPECS[t].accent}
          />
        ))}
      </div>

      {records === null ? (
        <p className="py-16 text-center text-[13px] text-subtle">读取中</p>
      ) : records.length === 0 ? (
        <div className="flex min-h-[36dvh] flex-col items-center justify-center gap-3">
          <p className="text-[13px] text-muted">
            {filter ? `还没有${TYPE_SPECS[filter].name}的记录` : '还没有记录'}
          </p>
          <p className="max-w-[16rem] text-center text-[12px] leading-relaxed text-subtle">
            记录存在这台设备上，从不上传。照片从来没有被保存过。
          </p>
          <Link to="/" className="btn-seal mt-4 h-12 w-full text-[15px]">
            去看一相
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {records.map((r) => {
            const spec = TYPE_SPECS[r.type]
            const stars = Object.values(r.envelope.scorecard)
            const avg = stars.reduce((a, b) => a + b, 0) / stars.length
            return (
              <li key={r.id} className="card relative overflow-hidden">
                <span
                  aria-hidden
                  className="absolute top-0 left-0 h-full w-[2px]"
                  style={{ background: spec.accent, opacity: 0.85 }}
                />
                <Link to={`/report/${r.id}`} className="flex items-start gap-3 p-4">
                  <TypeGlyph type={r.type} size={32} color={spec.accent} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-title text-[15px] tracking-[0.1em]">{spec.name}</span>
                      <span className="text-[11px] text-subtle">
                        {new Date(r.createdAt).toLocaleString('zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[12px] text-muted">
                      {summarize(r.report)}
                    </p>
                    <p className="mt-1.5 text-[11px] text-subtle">
                      实测 {r.envelope.features.length} 项 · 未观测{' '}
                      {r.envelope.unavailable.length} 项 · 均分 {avg.toFixed(1)}
                      {r.followUps.length > 0 && ` · 追问 ${r.followUps.length} 次`}
                    </p>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => void onDelete(r.id)}
                  className="absolute top-3 right-3 px-2 py-1 text-[11px] text-subtle"
                  aria-label="删除"
                >
                  删除
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-8 text-center text-[11px] text-subtle">{SHORT_DISCLAIMER}</p>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  accent,
}: {
  active: boolean
  onClick: () => void
  label: string
  accent?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 border px-4 py-1.5 text-[12px] transition-colors"
      style={{
        borderColor: active ? (accent ?? 'var(--color-gold-400)') : 'var(--line)',
        color: active ? 'var(--fg-base)' : 'var(--fg-subtle)',
        borderRadius: 2,
      }}
    >
      {label}
    </button>
  )
}

/** 取「性格特质」段的头一句做摘要 */
function summarize(report: string): string {
  const m = /##\s*性格特质\s*\n+([^\n]+)/.exec(report)
  const line = m?.[1] ?? report.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? ''
  return line.replace(/[-*·#]/g, '').replace(/\*\*/g, '').trim().slice(0, 40)
}
