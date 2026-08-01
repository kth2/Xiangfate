import { DIMENSION_DESC } from '@/core/scorecard'
import { SCORE_DIMENSIONS, type Scorecard } from '@/core/types'
import { SCORECARD_NOTE } from '@/copy/disclaimer.zh-CN'

/** 星级由本地规则算出，不经 AI —— 同一张照片每次都一样 */
export function ScoreCardView({ scorecard, accent }: { scorecard: Scorecard; accent: string }) {
  return (
    <section className="card p-4">
      <h2 className="font-title mb-4 text-sm tracking-[0.2em]">五维气象</h2>
      <ul className="flex flex-col gap-3">
        {SCORE_DIMENSIONS.map((dim) => (
          <li key={dim} className="flex items-center gap-3">
            <div className="w-20 shrink-0">
              <p className="font-title text-[13px] tracking-[0.05em]">{dim}</p>
            </div>
            <div className="flex gap-1" aria-label={`${dim} ${scorecard[dim]} 星`}>
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
            </div>
            <span className="ml-auto text-[11px] text-subtle">{DIMENSION_DESC[dim]}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[11px] leading-relaxed text-subtle">{SCORECARD_NOTE}</p>
    </section>
  )
}
