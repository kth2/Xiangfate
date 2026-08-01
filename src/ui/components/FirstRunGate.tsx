import { useSettings } from '@/store/settings.store'
import { FIRST_RUN } from '@/copy/disclaimer.zh-CN'
import { Seal } from './Seal'

/**
 * 首启免责声明。必须点击确认才能进入应用 —— 这是内容策略的第四道防线之一。
 * 见 docs/07-content-policy.md 第四节。
 */
export function FirstRunGate({ children }: { children: React.ReactNode }) {
  const accepted = useSettings((s) => s.disclaimerAccepted)
  const accept = useSettings((s) => s.acceptDisclaimer)

  if (accepted) return <>{children}</>

  return (
    <div className="page flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Seal size={52} />
          <h1 className="font-title text-center text-xl leading-relaxed">{FIRST_RUN.title}</h1>
        </div>

        <div className="rule-gold mb-6" />

        <p className="mb-6 text-center text-sm text-muted">{FIRST_RUN.lead}</p>

        <ul className="mb-8 flex flex-col gap-4">
          {FIRST_RUN.points.map((p) => (
            <li key={p.k} className="flex gap-3">
              <span
                aria-hidden
                className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-[var(--color-cinnabar-500)]"
              />
              <div>
                <p className="text-sm leading-relaxed">{p.k}</p>
                {p.v && <p className="mt-1 text-[13px] leading-relaxed text-subtle">{p.v}</p>}
              </div>
            </li>
          ))}
        </ul>

        <button type="button" onClick={accept} className="btn-seal h-12 w-full text-[15px]">
          {FIRST_RUN.cta}
        </button>
      </div>
    </div>
  )
}
