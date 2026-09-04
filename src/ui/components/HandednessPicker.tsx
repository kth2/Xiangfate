/**
 * 惯用手问一句。
 *
 * ── 为什么非问不可 ─────────────────────────────────────────
 * 相书说「左手先天、右手后天」，而它给出的理由是**右手是行事之手**。
 * 这个理由随利手而转：左撇子的行事之手是左手。
 *
 * 应用原先从不问，代码里把「第一张照片那只手」当成惯用手 ——
 * 于是左撇子拿到的报告把先天与后天说反了，而且不会有任何提示。
 * 一个静默的错误比一个明说的缺项糟得多，所以这里宁可多问一句。
 *
 * 「不确定」是正当答案：那种情况下不做先天／后天的分派，
 * 报告里如实写「对照暂缺」，而不是替用户猜一个。
 */

import type { Subject } from '@/core/types'

type Answer = NonNullable<Subject['dominantHand']> | 'unknown'

const OPTIONS: { value: Answer; label: string; hint: string }[] = [
  { value: 'right', label: '右手', hint: '写字、拿筷子用右手' },
  { value: 'left', label: '左手', hint: '写字、拿筷子用左手' },
  { value: 'unknown', label: '不确定', hint: '两手都灵便，或说不清' },
]

export function HandednessPicker({
  value,
  accent,
  onChange,
}: {
  /** null = 还没答；'left' | 'right' = 已答 */
  value: Subject['dominantHand'] | undefined
  accent: string
  onChange: (v: Subject['dominantHand']) => void
}) {
  const current: Answer | null = value === undefined ? null : (value ?? 'unknown')

  return (
    <section className="card p-4">
      <h2 className="font-title mb-1 text-sm tracking-[0.2em]">哪只手是惯用手</h2>
      <p className="mb-3 text-[11px] leading-relaxed text-subtle">
        相法以行事之手论后天、另一手论先天。左撇子的行事之手是左手，
        所以这一问不能靠拍摄顺序猜。不答也能出报告，只是先天／后天的对照会标为暂缺。
      </p>

      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((o) => {
          const on = current === o.value
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value === 'unknown' ? null : o.value)}
              aria-pressed={on}
              className="flex flex-col items-start border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: on ? accent : 'var(--line)',
                color: on ? 'var(--fg-base)' : 'var(--fg-subtle)',
                borderRadius: 2,
              }}
            >
              <span className="text-[13px]">{o.label}</span>
              <span className="mt-0.5 text-[10px] text-subtle">{o.hint}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
