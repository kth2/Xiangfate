import { Link } from 'react-router'
import { TYPE_SPECS } from '@/core/registry'
import { useAnalysis } from '@/store/analysis.store'
import { BANNER } from '@/copy/disclaimer.zh-CN'

/**
 * 报告页。第三步接入：特征提取 → 规则映射 → AI 解读 → 追问。
 * 当前只呈现本次会话已采集到的内容。
 */
export function Report() {
  const type = useAnalysis((s) => s.type)
  const shots = useAnalysis((s) => s.shots)
  const spec = type ? TYPE_SPECS[type] : null

  return (
    <div className="page px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-title text-[13px] tracking-[0.1em] text-muted">
          ← 首页
        </Link>
        <h1 className="font-title text-base tracking-[0.25em]">{spec?.name ?? '报告'}</h1>
        <span className="w-12" />
      </div>

      <p
        className="mt-5 border-l-2 py-2 pl-3 text-[12px] leading-relaxed text-muted"
        style={{ borderColor: 'var(--color-cinnabar-500)' }}
      >
        {BANNER}
      </p>

      <div className="rule-gold my-6" />

      {!spec ? (
        <p className="text-[13px] text-muted">还没有进行中的分析。</p>
      ) : (
        <>
          <div className="card mb-5 p-4">
            <p className="mb-2 text-[13px]">已采集 {shots.length} 张照片</p>
            <p className="text-[12px] leading-relaxed text-subtle">
              端侧关键点检测已跑通。下一步（第三步）接入：几何度量 → 规则映射 →
              结构化 JSON → AI 解读 → 多轮追问。
            </p>
          </div>

          <div className="card p-4">
            <p className="mb-3 text-[13px]">{spec.name} · 待接入的分析维度</p>
            <ul className="flex flex-col gap-2">
              {spec.aspects.map((a) => (
                <li key={a} className="flex items-center gap-2 text-[12px] text-muted">
                  <span
                    aria-hidden
                    className="h-1 w-1 rounded-full"
                    style={{ background: spec.accent }}
                  />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <Link to="/" className="btn-outline mt-8 h-12 w-full text-[15px]">
        回首页
      </Link>
    </div>
  )
}
