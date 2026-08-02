import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  filterModels,
  formatContext,
  listModels,
  type ModelInfo,
  type ModelListResult,
  type ProviderId,
} from '@/ai/models'

/**
 * 模型选择器。
 *
 * 列表从服务商 API 实时拉取，不再硬编码 —— 硬编码的清单注定会过期。
 * 拉不到时回落到缓存或兜底清单，并在界面上标明来源，用户能看出这份列表
 * 到底新不新。任何情况下都允许手填模型 ID，不把人锁死在我们的列表里。
 */
export function ModelPicker({
  provider,
  apiKey,
  baseUrl,
  value,
  onChange,
  needsKeyToList,
  accent = 'var(--color-gold-400)',
}: {
  provider: ProviderId
  apiKey: string
  baseUrl: string
  value: string
  onChange: (id: string) => void
  needsKeyToList: boolean
  accent?: string
}) {
  const [result, setResult] = useState<ModelListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [manual, setManual] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const canList = !needsKeyToList || apiKey.trim().length > 0

  const load = useCallback(
    async (force: boolean) => {
      if (!canList) return
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      setLoading(true)
      setError(null)
      try {
        const r = await listModels(provider, {
          apiKey,
          baseUrl,
          force,
          signal: ac.signal,
        })
        setResult(r)
        if (r.source === 'fallback') {
          setError('没能从服务商拉到模型列表，下面是内置的兜底清单，可能已经过期')
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return
        setError('模型列表拉取失败，检查一下 Key 和网络；也可以手动填模型 ID')
      } finally {
        setLoading(false)
      }
    },
    [provider, apiKey, baseUrl, canList],
  )

  // 切换服务商 / 填好 Key 之后自动拉一次（走缓存，不强制刷新）
  useEffect(() => {
    setResult(null)
    setQuery('')
    if (canList) void load(false)
    return () => abortRef.current?.abort()
  }, [provider, canList, load])

  const models = result?.models ?? []
  const shown = useMemo(() => filterModels(models, query), [models, query])
  const selectedKnown = models.some((m) => m.id === value)
  // 只有在确实拿到了实时列表的前提下才敢说「这个模型不存在」——
  // 缓存或兜底清单不全，据此报警会误伤
  const staleSelection = Boolean(
    value && !selectedKnown && result?.source === 'live' && models.length > 0,
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <label className="text-[13px]">模型</label>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading || !canList}
          className="text-[12px] disabled:opacity-40"
          style={{ color: accent }}
        >
          {loading ? '拉取中…' : '刷新列表'}
        </button>
      </div>

      {!canList && (
        <p className="text-[12px] leading-relaxed text-subtle">
          先填上面的 API Key，才能拉取可用模型列表。
        </p>
      )}

      {/* 当前选中 */}
      <div
        className="flex items-center justify-between gap-2 border px-3 py-2.5"
        style={{ borderColor: staleSelection ? 'var(--color-cinnabar-500)' : accent, borderRadius: 2 }}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
          {value || '（未选择）'}
        </span>
        {!selectedKnown && value && (
          <span className="shrink-0 text-[11px] text-subtle">自填</span>
        )}
      </div>

      {/* 选中的模型不在服务商的实时列表里 —— 多半是被下线了，说清楚比默默失败强 */}
      {staleSelection && (
        <p
          className="border-l-2 py-1.5 pl-3 text-[12px] leading-relaxed text-muted"
          style={{ borderColor: 'var(--color-cinnabar-500)' }}
        >
          这个模型不在服务商当前的可用列表里，可能已经下线或改名。
          从下面挑一个，否则生成解读时会报错。
        </p>
      )}

      {error && (
        <p
          className="border-l-2 py-1.5 pl-3 text-[12px] leading-relaxed text-muted"
          style={{ borderColor: 'var(--color-cinnabar-500)' }}
        >
          {error}
        </p>
      )}

      {canList && models.length > 0 && (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`搜索 ${models.length} 个模型…`}
            className="border bg-transparent px-3 py-2.5 text-[13px] outline-none"
            style={{ borderColor: 'var(--line)', borderRadius: 2 }}
          />

          <ul
            className="flex max-h-72 flex-col overflow-y-auto border"
            style={{ borderColor: 'var(--line)', borderRadius: 2 }}
          >
            {shown.length === 0 && (
              <li className="px-3 py-4 text-center text-[12px] text-subtle">
                没有匹配的模型，可以手动填 ID
              </li>
            )}
            {shown.map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                selected={m.id === value}
                accent={accent}
                onPick={() => onChange(m.id)}
              />
            ))}
          </ul>

          <p className="text-[11px] text-subtle">
            {result?.source === 'live'
              ? '刚从服务商拉取'
              : result?.source === 'cache'
                ? `来自本地缓存${result.fetchedAt ? `（${formatAge(result.fetchedAt)}）` : ''}，点「刷新列表」取最新`
                : '内置兜底清单，可能已过期'}
          </p>
        </>
      )}

      {/* 手填 —— 不把人锁死在我们的列表里 */}
      <button
        type="button"
        onClick={() => setManual((v) => !v)}
        className="self-start text-[12px] text-subtle"
      >
        {manual ? '收起' : '手动填写模型 ID'}
      </button>

      {manual && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例如 gemini-2.5-flash"
          autoComplete="off"
          spellCheck={false}
          className="border bg-transparent px-3 py-2.5 font-mono text-[13px] outline-none"
          style={{ borderColor: 'var(--line)', borderRadius: 2 }}
        />
      )}
    </div>
  )
}

function ModelRow({
  model,
  selected,
  accent,
  onPick,
}: {
  model: ModelInfo
  selected: boolean
  accent: string
  onPick: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2.5 text-left last:border-b-0"
        style={{
          borderColor: 'var(--line)',
          background: selected ? 'var(--bg-sunken)' : 'transparent',
        }}
      >
        <div className="flex w-full items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-[13px]"
            style={{ color: selected ? accent : 'var(--fg-base)' }}
          >
            {model.label}
          </span>
          {model.free && (
            <span
              className="shrink-0 px-1.5 py-0.5 text-[10px]"
              style={{ border: `1px solid ${accent}`, color: accent, borderRadius: 2 }}
            >
              免费
            </span>
          )}
        </div>
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle">
            {model.id}
          </span>
          <span className="shrink-0 text-[11px] text-subtle">
            {[formatContext(model.contextLength), model.note].filter(Boolean).join(' · ')}
          </span>
        </div>
      </button>
    </li>
  )
}

function formatAge(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
