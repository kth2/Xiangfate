import { useState } from 'react'
import { SURVEY_COPY, SURVEY_QUESTIONS, type SurveyAnswers } from '@/modules/tixiang/survey'

/**
 * 体相可选自评。补足照片测不到的维度。
 * 身高体重单列且明确说明只用于换算，不生成任何高矮胖瘦的评价。
 */
export function BodySurvey({
  accent,
  onDone,
}: {
  accent: string
  onDone: (a: SurveyAnswers | null) => void
}) {
  const [answers, setAnswers] = useState<SurveyAnswers>({})

  const pick = (key: keyof SurveyAnswers, value: string) =>
    setAnswers((a) => ({ ...a, [key]: a[key] === value ? undefined : value }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-title mb-2 text-lg tracking-[0.1em]">{SURVEY_COPY.title}</h2>
        <p className="text-[13px] leading-relaxed text-muted">{SURVEY_COPY.note}</p>
      </div>

      {SURVEY_QUESTIONS.map((q) => (
        <div key={q.key}>
          <p className="mb-2.5 text-[13px]">{q.question}</p>
          <div className="flex flex-wrap gap-2">
            {q.options.map((o) => {
              const on = answers[q.key] === o
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => pick(q.key, o)}
                  className="border px-3.5 py-2 text-[13px] transition-colors"
                  style={{
                    borderColor: on ? accent : 'var(--line)',
                    color: on ? 'var(--fg-base)' : 'var(--fg-subtle)',
                    borderRadius: 2,
                  }}
                >
                  {o}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div>
        <p className="mb-1 text-[13px]">{SURVEY_COPY.bodyTitle}</p>
        <p className="mb-2.5 text-[11px] leading-relaxed text-subtle">{SURVEY_COPY.bodyNote}</p>
        <div className="flex gap-2">
          <NumInput
            placeholder="身高 cm"
            value={answers.heightCm ?? ''}
            onChange={(v) => setAnswers((a) => ({ ...a, heightCm: v }))}
          />
          <NumInput
            placeholder="体重 kg"
            value={answers.weightKg ?? ''}
            onChange={(v) => setAnswers((a) => ({ ...a, weightKg: v }))}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => onDone(answers)}
          className="btn-seal h-12 w-full text-[15px]"
        >
          出报告
        </button>
        <button
          type="button"
          onClick={() => onDone(null)}
          className="py-2 text-center text-[13px] text-subtle"
        >
          {SURVEY_COPY.skip}
        </button>
      </div>
    </div>
  )
}

function NumInput({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string
  value: number | string
  onChange: (v: number | null) => void
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="min-w-0 flex-1 border bg-transparent px-3 py-2.5 text-[13px] outline-none"
      style={{ borderColor: 'var(--line)', borderRadius: 2 }}
    />
  )
}
