import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ALL_TYPES, TYPE_SPECS, type TypeSpec } from '@/core/registry'
import { formatMb, isModelCached, totalBytes } from '@/mediapipe/loader'
import { useAnalysis } from '@/store/analysis.store'
import { useIsConfigured } from '@/store/settings.store'
import { Seal } from '../components/Seal'
import { TypeGlyph } from '../components/TypeGlyph'

export function Home() {
  const navigate = useNavigate()
  const start = useAnalysis((s) => s.start)
  const configured = useIsConfigured()
  const [cached, setCached] = useState<Record<string, boolean>>({})

  // 首页展示各类型模型是否已就绪，避免用户点进去才发现要下 8MB
  useEffect(() => {
    let alive = true
    void (async () => {
      const entries = await Promise.all(
        ALL_TYPES.map(async (t) => {
          const spec = TYPE_SPECS[t]
          const all = await Promise.all(spec.detectors.map(isModelCached))
          return [t, all.every(Boolean)] as const
        }),
      )
      if (alive) setCached(Object.fromEntries(entries))
    })()
    return () => {
      alive = false
    }
  }, [])

  function onPick(spec: TypeSpec) {
    start(spec.type)
    void navigate(`/capture/${spec.type}`)
  }

  return (
    <div className="page px-6 pb-16">
      <header className="flex items-start justify-between pt-8">
        <div>
          <h1 className="font-title text-[2rem] leading-tight tracking-[0.2em]">相由</h1>
          <p className="mt-2 text-[13px] tracking-[0.15em] text-subtle">
            相由心生 · 命由己造
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/history"
            className="font-title text-[13px] tracking-[0.1em] text-muted"
            aria-label="历史记录"
          >
            往迹
          </Link>
          <Link
            to="/settings"
            className="font-title text-[13px] tracking-[0.1em] text-muted"
            aria-label="设置"
          >
            设置
          </Link>
        </div>
      </header>

      <div className="rule-gold mt-6 mb-8" />

      {!configured && (
        <Link
          to="/settings"
          className="card mb-6 flex items-center justify-between px-4 py-3 no-underline"
          style={{ borderColor: 'var(--line-strong)' }}
        >
          <div>
            <p className="text-[13px]">还没配置 AI 接口</p>
            <p className="mt-0.5 text-[12px] text-subtle">
              特征提取不需要联网，但生成解读需要一个 API Key
            </p>
          </div>
          <span className="font-title text-[13px] text-[var(--color-gold-400)]">去配置 →</span>
        </Link>
      )}

      <p className="mb-5 text-[13px] leading-relaxed text-muted">选一种，先看哪一相？</p>

      <div className="grid grid-cols-2 gap-3">
        {ALL_TYPES.map((t) => {
          const spec = TYPE_SPECS[t]
          const ready = cached[t]
          const bytes = totalBytes(spec.detectors)
          return (
            <button
              key={t}
              type="button"
              onClick={() => onPick(spec)}
              className="card group relative flex flex-col items-start gap-3 p-4 text-left transition-transform active:scale-[0.98]"
              style={{ borderColor: 'var(--line)' }}
            >
              <span
                aria-hidden
                className="absolute top-0 left-0 h-full w-[2px] rounded-l"
                style={{ background: spec.accent, opacity: 0.85 }}
              />

              <TypeGlyph type={t} size={40} color={spec.accent} />

              <div>
                <h2 className="font-title text-lg tracking-[0.15em]">{spec.name}</h2>
                <p className="mt-1 text-[12px] tracking-wide text-subtle">{spec.tagline}</p>
              </div>

              <p className="text-[12px] leading-relaxed text-muted">{spec.summary}</p>

              <span className="mt-auto pt-1 text-[11px] text-subtle">
                {ready === undefined ? ' ' : ready ? '模型已就绪' : `需下载 ${formatMb(bytes)}`}
              </span>
            </button>
          )
        })}
      </div>

      <div className="rule-gold mt-10 mb-6" />

      <section className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Seal size={34} text="私" />
          <div>
            <p className="text-[13px]">照片不离开你的设备</p>
            <p className="mt-1 text-[12px] leading-relaxed text-subtle">
              关键点检测与特征计算全部在浏览器本地完成。发给 AI 的只有算出来的数值，
              比如「三停比例 34% : 33% : 33%」，不含照片，也不含关键点坐标。
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-10 flex flex-col items-center gap-3">
        <p className="text-center text-[11px] leading-relaxed text-subtle">
          仅供娱乐与传统文化参考，不构成任何决策建议
        </p>
        <Link to="/about" className="font-title text-[12px] tracking-[0.1em] text-muted">
          关于 · 知识来源
        </Link>
      </footer>
    </div>
  )
}
