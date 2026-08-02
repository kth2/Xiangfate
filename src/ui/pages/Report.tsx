import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { TYPE_SPECS } from '@/core/registry'
import { CrisisInterrupt, AnalysisSession, createProvider } from '@/ai/session'
import { friendlyError } from '@/ai/provider'
import { appendFollowUp, getRecord, saveRecord, type HistoryRecord } from '@/db/idb'
import { useAnalysis } from '@/store/analysis.store'
import { useSettings } from '@/store/settings.store'
import { BANNER, CARE_CARD, FULL_DISCLAIMER, SHORT_DISCLAIMER } from '@/copy/disclaimer.zh-CN'
import { PRESET_HINT, presetsFor } from '@/copy/questions.zh-CN'
import type { AnalysisEnvelope } from '@/core/types'
import { Markdown } from '../components/Markdown'
import { ScoreCardView } from '../components/ScoreCard'
import { FeatureList } from '../components/FeatureList'

type Stage = 'idle' | 'streaming' | 'regenerating' | 'done' | 'error'

export function Report() {
  const { id } = useParams()
  const navigate = useNavigate()

  const type = useAnalysis((s) => s.type)
  const envelopeFromStore = useAnalysis((s) => s.envelope)
  const reset = useAnalysis((s) => s.reset)

  const { provider: providerId, configs } = useSettings()
  const cfg = configs[providerId]

  const [envelope, setEnvelope] = useState<AnalysisEnvelope | null>(envelopeFromStore)
  const [report, setReport] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [regenReasons, setRegenReasons] = useState<string[]>([])
  const [followUps, setFollowUps] = useState<{ question: string; answer: string }[]>([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [pending, setPending] = useState('')
  const [showCare, setShowCare] = useState(false)
  const [recordId, setRecordId] = useState<string | null>(id ?? null)

  const sessionRef = useRef<AnalysisSession | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const startedRef = useRef(false)

  const spec = envelope ? TYPE_SPECS[envelope.analysisType] : type ? TYPE_SPECS[type] : null
  const accent = spec?.accent ?? 'var(--color-gold-400)'

  // 预设问题：问过的就撤掉，免得点重复
  const asked = new Set(followUps.map((f) => f.question))
  const presets = envelope
    ? presetsFor(envelope.analysisType).filter((p) => !asked.has(p.text))
    : []

  /* ---- 历史记录：从 IndexedDB 读 ---- */
  useEffect(() => {
    if (!id) return
    let alive = true
    void getRecord(id).then((rec) => {
      if (!alive || !rec) return
      setEnvelope(rec.envelope)
      setReport(rec.report)
      setFollowUps(rec.followUps.map((f) => ({ question: f.question, answer: f.answer })))
      setStage('done')
    })
    return () => {
      alive = false
    }
  }, [id])

  /* ---- 新分析：生成报告 ---- */
  const generate = useCallback(async () => {
    if (!envelope || startedRef.current) return
    startedRef.current = true

    let session: AnalysisSession
    try {
      session = new AnalysisSession(createProvider(providerId, cfg.apiKey, cfg.model, cfg.baseUrl), envelope)
    } catch (e) {
      setError(e instanceof Error ? e.message : '还没配置 API Key')
      setStage('error')
      return
    }
    sessionRef.current = session

    const ac = new AbortController()
    abortRef.current = ac
    setStage('streaming')
    setError(null)
    setReport('')

    try {
      for await (const ev of session.generateReport(ac.signal)) {
        if (ev.delta) setReport((r) => r + ev.delta)
        if (ev.regenerating) {
          setRegenReasons(ev.regenerating)
          setStage('regenerating')
          setReport('')
        }
        if (ev.done) {
          setReport(ev.done.text)
          setStage('done')
          const rec: HistoryRecord = {
            id: envelope.analysisId,
            type: envelope.analysisType,
            createdAt: Date.now(),
            envelope,
            report: ev.done.text,
            followUps: [],
          }
          void saveRecord(rec)
          setRecordId(envelope.analysisId)
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return
      setError(friendlyError(e))
      setStage('error')
    }
  }, [envelope, providerId, cfg.apiKey, cfg.model, cfg.baseUrl])

  useEffect(() => {
    if (!id && envelope && stage === 'idle') void generate()
  }, [id, envelope, stage, generate])

  useEffect(() => () => abortRef.current?.abort(), [])

  /* ---- 追问 ---- */
  function onAsk(e: React.FormEvent) {
    e.preventDefault()
    void ask(question)
  }

  async function ask(raw: string) {
    const q = raw.trim()
    if (!q || asking) return

    // 历史记录页重新提问时，会话已丢失 —— 重建一个
    if (!sessionRef.current && envelope) {
      try {
        sessionRef.current = new AnalysisSession(
          createProvider(providerId, cfg.apiKey, cfg.model, cfg.baseUrl),
          envelope,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : '还没配置 API Key')
        return
      }
    }
    const session = sessionRef.current
    if (!session) return

    setQuestion('')
    setAsking(true)
    setPending('')
    setShowCare(false)

    const ac = new AbortController()
    abortRef.current = ac

    try {
      for await (const ev of session.ask(q, ac.signal)) {
        if (ev.delta) setPending((p) => p + ev.delta)
        if (ev.done) {
          setFollowUps((f) => [...f, { question: q, answer: ev.done!.text }])
          setPending('')
          if (recordId) void appendFollowUp(recordId, q, ev.done.text)
        }
      }
    } catch (err) {
      if (err instanceof CrisisInterrupt) {
        // 这一轮刻意不发给 AI
        setShowCare(true)
      } else if (!(err instanceof Error && err.name === 'AbortError')) {
        setError(friendlyError(err))
      }
      setPending('')
    } finally {
      setAsking(false)
    }
  }

  /* ---- 无数据 ---- */
  if (!envelope) {
    return (
      <div className="page px-6 pt-8 pb-16">
        <Header title="报告" onBack={() => navigate('/')} />
        <div className="rule-gold my-6" />
        <p className="text-[13px] text-muted">还没有进行中的分析。</p>
        <Link to="/" className="btn-seal mt-6 h-12 w-full text-[15px]">
          去看一相
        </Link>
      </div>
    )
  }

  const busy = stage === 'streaming' || stage === 'regenerating'

  return (
    <div className="page px-6 pt-8 pb-16">
      <Header
        title={spec?.name ?? '报告'}
        onBack={() => {
          abortRef.current?.abort()
          reset()
          void navigate('/')
        }}
      />

      <p
        className="mt-5 border-l-2 py-2 pl-3 text-[12px] leading-relaxed text-muted"
        style={{ borderColor: 'var(--color-cinnabar-500)' }}
      >
        {BANNER}
      </p>

      <div className="rule-gold my-6" />

      <div className="flex flex-col gap-5">
        <ScoreCardView
          scorecard={envelope.scorecard}
          features={envelope.features}
          accent={accent}
        />

        <FeatureList
          features={envelope.features}
          unavailable={envelope.unavailable}
          accent={accent}
        />

        {/* ---- 报告正文 ---- */}
        <section className="card p-4">
          {stage === 'regenerating' && (
            <div className="mb-4 border-l-2 py-2 pl-3" style={{ borderColor: accent }}>
              <p className="text-[12px] text-muted">措辞不合规范，正在重新生成</p>
              {regenReasons.slice(0, 2).map((r) => (
                <p key={r} className="mt-1 text-[11px] leading-relaxed text-subtle">
                  {r}
                </p>
              ))}
            </div>
          )}

          {stage === 'error' ? (
            <div className="py-6 text-center">
              <p className="text-[13px] text-muted">{error}</p>
              <button
                type="button"
                onClick={() => {
                  startedRef.current = false
                  setStage('idle')
                }}
                className="btn-outline mt-4 h-11 px-8 text-[14px]"
              >
                重试
              </button>
            </div>
          ) : report ? (
            <Markdown text={report} accent={accent} />
          ) : (
            <div className="flex items-center gap-3 py-8">
              <span
                aria-hidden
                className="h-1 w-1 animate-pulse rounded-full"
                style={{ background: accent }}
              />
              <p className="font-title text-[13px] tracking-[0.2em] text-muted">正在推演</p>
            </div>
          )}

          {busy && report && (
            <span
              aria-hidden
              className="mt-2 inline-block h-3 w-[2px] animate-pulse align-text-bottom"
              style={{ background: accent }}
            />
          )}
        </section>

        {/* ---- 追问 ---- */}
        {stage === 'done' && (
          <section className="card p-4">
            <h2 className="font-title mb-4 text-sm tracking-[0.2em]">继续问</h2>

            {followUps.map((f, i) => (
              <div key={i} className="mb-5">
                <p className="mb-2 text-[13px]" style={{ color: accent }}>
                  {f.question}
                </p>
                <Markdown text={f.answer} accent={accent} />
              </div>
            ))}

            {pending && (
              <div className="mb-5">
                <Markdown text={pending} accent={accent} />
              </div>
            )}

            {showCare && (
              <div
                className="mb-5 border-l-2 py-3 pl-3"
                style={{ borderColor: 'var(--color-cinnabar-500)' }}
              >
                <p className="mb-2 text-[13px]">{CARE_CARD.title}</p>
                <p className="text-[12px] leading-loose whitespace-pre-line text-muted">
                  {CARE_CARD.body}
                </p>
              </div>
            )}

            {/* ---- 预设问题：来自 docs/xiangshu-qa-knowledge.md ---- */}
            {presets.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-[11px] text-subtle">{PRESET_HINT}</p>
                <div className="flex flex-wrap gap-2">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={asking}
                      onClick={() => void ask(p.text)}
                      className="border px-3 py-1.5 text-left text-[12px] text-muted disabled:opacity-40"
                      style={{ borderColor: 'var(--line)', borderRadius: 2 }}
                    >
                      {p.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={onAsk} className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="想再问点什么？"
                disabled={asking}
                className="min-w-0 flex-1 border bg-transparent px-3 py-2.5 text-[13px] outline-none"
                style={{ borderColor: 'var(--line)', borderRadius: 2 }}
              />
              <button
                type="submit"
                disabled={asking || !question.trim()}
                className="btn-seal shrink-0 px-5 text-[14px]"
              >
                {asking ? '…' : '问'}
              </button>
            </form>
          </section>
        )}

        {/* ---- 免责声明：由 App 渲染，不经过 AI ---- */}
        <section className="pt-2">
          <div className="rule-gold mb-5" />
          <p className="mb-3 text-[11px] tracking-[0.2em] text-subtle">免责声明</p>
          <p className="text-[11px] leading-loose whitespace-pre-line text-subtle">
            {FULL_DISCLAIMER.replaceAll('**', '')}
          </p>
        </section>

        <div className="flex gap-3">
          <Link to="/history" className="btn-outline h-12 flex-1 text-[14px]">
            往迹
          </Link>
          <Link
            to="/"
            onClick={() => reset()}
            className="btn-outline h-12 flex-1 text-[14px]"
          >
            再看一相
          </Link>
        </div>

        <p className="text-center text-[11px] text-subtle">{SHORT_DISCLAIMER}</p>
      </div>
    </div>
  )
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onBack}
        className="font-title text-[13px] tracking-[0.1em] text-muted"
      >
        ← 首页
      </button>
      <h1 className="font-title text-base tracking-[0.25em]">{title}</h1>
      <span className="w-12" />
    </div>
  )
}
