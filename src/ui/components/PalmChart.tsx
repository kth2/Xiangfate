import { useMemo } from 'react'
import type { FeatureItem, UnavailableItem } from '@/core/types'
import type { PalmOverlay } from '@/store/analysis.store'
import { PalmAnnotated } from './PalmAnnotated'

/**
 * 掌纹标注图 + 逐条对号解读。
 *
 * ⚠️ 这一栏**不新增任何判断**。每一条的措辞都来自 rules.ts 已经出过的特征：
 * 粗体是断语（label），下一行是释义（meaning），末行是实测凭据（evidence）。
 * 它做的只是换个排版 —— 把断语摆到图上对应的号旁边，让人能一眼对上。
 *
 * 与那种「十条全给满」的掌纹长图的区别就在这里：
 * 没测到的线照样占一个号，如实写「未测到」。宁可空着，也不凑满十条。
 */
export function PalmChart({
  overlay,
  features,
  unavailable,
  accent,
}: {
  overlay: PalmOverlay
  features: FeatureItem[]
  unavailable: UnavailableItem[]
  accent: string
}) {
  /** 按 featureId 前缀把主项与子项（如 hand.line.life.continuity）归到同一个号下 */
  const rows = useMemo(
    () =>
      overlay.marks.map((m) => ({
        mark: m,
        items: features.filter((f) => f.id === m.featureId || f.id.startsWith(`${m.featureId}.`)),
        missing: unavailable.filter(
          (u) => u.id === m.featureId || u.id.startsWith(`${m.featureId}.`),
        ),
      })),
    [overlay.marks, features, unavailable],
  )

  const marked = overlay.marks.filter((m) => m.anchor).length

  return (
    <section className="card overflow-hidden">
      <div className="p-4 pb-3">
        <h2 className="font-title mb-1 text-sm tracking-[0.2em]">掌纹标注</h2>
        <p className="text-[11px] leading-relaxed text-subtle">
          你那张照片上的 {marked} 处标号对应下方条目。实心号为掌线，空心号为掌丘。
          断语与释义均来自本次实测，未经 AI 改写。
        </p>
      </div>

      <div style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <PalmAnnotated overlay={overlay} accent={accent} />
      </div>

      <ol className="p-4">
        {rows.map(({ mark, items, missing }) => (
          <li key={`${mark.n}-${mark.featureId}`} className="mb-4 flex gap-3 last:mb-0">
            <span
              aria-hidden
              className="mt-[2px] flex h-[22px] w-[22px] shrink-0 items-center justify-center border text-[11px] leading-none"
              style={{
                borderColor: mark.anchor ? accent : 'var(--line)',
                color: mark.anchor ? accent : 'var(--fg-subtle)',
                borderRadius: mark.kind === 'mount' ? '50%' : 2,
              }}
            >
              {mark.n}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug">
                <span className="font-title tracking-[0.08em]">{mark.name}</span>
                {/* 图上没号有两种原因，别混成一句：没测到，还是测到了但号落在照片外 */}
                {!mark.anchor &&
                  (items.length ? (
                    <span className="ml-2 text-[11px] text-subtle">已测到 · 标号落在照片之外</span>
                  ) : (
                    <span className="ml-2 text-[11px] text-subtle">未测到 · 图上未标号</span>
                  ))}
              </p>

              {items.map((f) => (
                <div key={f.id} className="mt-1.5">
                  <p className="text-[13px] leading-relaxed">
                    <span style={{ color: accent }}>{f.label}</span>
                    <span className="text-muted">　{f.meaning}</span>
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-subtle">
                    {f.evidence}
                    {f.source && ` · 《${f.source}》`}
                  </p>
                </div>
              ))}

              {items.length === 0 &&
                (missing.length ? (
                  missing.map((u) => (
                    <p key={u.id} className="mt-1.5 text-[12px] leading-relaxed text-muted">
                      {u.detail}
                    </p>
                  ))
                ) : (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                    这条本次没有测到，报告里也不会替它编话。
                  </p>
                ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
