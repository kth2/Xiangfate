/**
 * 模型列表：从服务商 API 实时拉取。
 *
 * 之前是硬编码的一小串模型名 —— 那注定会过期，用户看到的永远是写代码那天
 * 的模型。现在改成实时拉取 + 本地缓存，服务商上新模型立刻就能选到。
 *
 * 拉不到时回落到一份最小的兜底清单，并在 UI 上标明「可能已过期」。
 */

export type ProviderId = 'gemini' | 'openrouter'

export interface ModelInfo {
  /** 传给 API 的模型 ID */
  id: string
  /** 展示名 */
  label: string
  /** 上下文长度（token），未知为 null */
  contextLength: number | null
  /** 是否免费 */
  free: boolean
  /** 附加说明，如价格 */
  note?: string
}

export interface ModelListResult {
  models: ModelInfo[]
  /** 数据来源：live = 刚从 API 拉的，cache = 本地缓存，fallback = 兜底清单 */
  source: 'live' | 'cache' | 'fallback'
  fetchedAt: number | null
}

/* ============================================================
   默认端点。允许用户覆盖 —— BYO Key 场景下，有人会走自建代理或镜像
   ============================================================ */

export const DEFAULT_BASE_URL: Record<ProviderId, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
}

/**
 * 把用户填的端点归一成一个可用的绝对地址。
 *
 * 设置里 baseUrl 的默认值是空串（「留空用默认」），而函数默认参数只对
 * undefined 生效，不对 ''。之前 provider 直接写 `baseUrl = DEFAULT_BASE_URL.x`，
 * 空串就这么穿了过去，请求地址退化成 `/models/xxx:streamGenerateContent`
 * —— 相对路径，打到自己站点上。Vercel 把它 rewrite 到 index.html，
 * 对静态文件 POST 返回 405，于是所有人的分析都失败。
 *
 * 顺带挡住「填了但不是绝对 http(s) 地址」的情况：与其静悄悄地把 API Key
 * POST 到本站，不如当场报错说清楚。
 */
export function normalizeBaseUrl(provider: ProviderId, baseUrl?: string | null): string {
  const raw = baseUrl?.trim()
  if (!raw) return DEFAULT_BASE_URL[provider]

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`接口地址「${raw}」不是合法的 URL，去设置页改一下，或者留空用默认`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`接口地址必须以 http:// 或 https:// 开头，现在是「${raw}」`)
  }
  return raw.replace(/\/+$/, '')
}

/* ============================================================
   兜底清单 —— 只在拉取失败时用，UI 会标明可能已过期
   ============================================================ */

const FALLBACK: Record<ProviderId, ModelInfo[]> = {
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', contextLength: 1_048_576, free: true },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextLength: 1_048_576, free: false },
  ],
  openrouter: [
    {
      id: 'deepseek/deepseek-chat-v3.1:free',
      label: 'DeepSeek Chat v3.1 (free)',
      contextLength: null,
      free: true,
    },
  ],
}

/* ============================================================
   缓存
   ============================================================ */

const CACHE_KEY = 'xiangfate.models'
const TTL_MS = 24 * 60 * 60 * 1000

interface CacheEntry {
  models: ModelInfo[]
  fetchedAt: number
}

function readCache(provider: ProviderId): CacheEntry | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}.${provider}`)
    if (!raw) return null
    const e = JSON.parse(raw) as CacheEntry
    if (!Array.isArray(e.models) || !e.models.length) return null
    return e
  } catch {
    return null
  }
}

function writeCache(provider: ProviderId, models: ModelInfo[]): void {
  try {
    localStorage.setItem(
      `${CACHE_KEY}.${provider}`,
      JSON.stringify({ models, fetchedAt: Date.now() } satisfies CacheEntry),
    )
  } catch {
    /* 存不下就算了，下次重新拉 */
  }
}

export function clearModelCache(): void {
  for (const p of ['gemini', 'openrouter'] as ProviderId[]) {
    try {
      localStorage.removeItem(`${CACHE_KEY}.${p}`)
    } catch {
      /* ignore */
    }
  }
}

/* ============================================================
   拉取
   ============================================================ */

export interface FetchOptions {
  apiKey?: string
  baseUrl?: string
  /** 忽略缓存，强制重新拉 */
  force?: boolean
  signal?: AbortSignal
}

export async function listModels(
  provider: ProviderId,
  opts: FetchOptions = {},
): Promise<ModelListResult> {
  if (!opts.force) {
    const cached = readCache(provider)
    if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
      return { models: cached.models, source: 'cache', fetchedAt: cached.fetchedAt }
    }
  }

  try {
    const models =
      provider === 'gemini'
        ? await fetchGeminiModels(opts)
        : await fetchOpenRouterModels(opts)

    if (models.length) {
      writeCache(provider, models)
      return { models, source: 'live', fetchedAt: Date.now() }
    }
  } catch {
    /* 落到下面的回退 */
  }

  // 拉取失败：优先用过期缓存（好过兜底清单），再不行才用兜底
  const stale = readCache(provider)
  if (stale) return { models: stale.models, source: 'cache', fetchedAt: stale.fetchedAt }
  return { models: FALLBACK[provider], source: 'fallback', fetchedAt: null }
}

/**
 * Gemini models.list。需要 API Key。
 * 只保留支持 streamGenerateContent 的模型 —— 本应用全程走流式。
 */
async function fetchGeminiModels(opts: FetchOptions): Promise<ModelInfo[]> {
  if (!opts.apiKey?.trim()) throw new Error('need key')
  const base = normalizeBaseUrl('gemini', opts.baseUrl)

  const out: ModelInfo[] = []
  let pageToken: string | undefined

  // 分页拉完，避免漏掉新模型
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${base}/models`)
    url.searchParams.set('pageSize', '200')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url, {
      headers: { 'x-goog-api-key': opts.apiKey },
      signal: opts.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = (await res.json()) as {
      models?: {
        name?: string
        displayName?: string
        description?: string
        inputTokenLimit?: number
        supportedGenerationMethods?: string[]
      }[]
      nextPageToken?: string
    }

    for (const m of data.models ?? []) {
      const id = (m.name ?? '').replace(/^models\//, '')
      if (!id) continue
      const methods = m.supportedGenerationMethods ?? []
      // 没有明确列出方法时也放行 —— 字段可能被精简，不要误杀新模型
      if (methods.length && !methods.some((x) => /generateContent/i.test(x))) continue
      // 嵌入、TTS、图像等非对话模型排除
      if (/embedding|aqa|imagen|veo|tts|image-generation/i.test(id)) continue

      out.push({
        id,
        label: m.displayName || id,
        contextLength: m.inputTokenLimit ?? null,
        // Gemini 的免费额度按 Key 的计费状态定，接口不告诉我们，一律不标价
        free: false,
        note: m.description?.slice(0, 60),
      })
    }

    pageToken = data.nextPageToken
    if (!pageToken) break
  }

  return dedupe(out).sort(byPreferredOrder)
}

/** OpenRouter GET /models —— 公开端点，不需要 Key */
async function fetchOpenRouterModels(opts: FetchOptions): Promise<ModelInfo[]> {
  const base = normalizeBaseUrl('openrouter', opts.baseUrl)
  const res = await fetch(`${base}/models`, { signal: opts.signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  const data = (await res.json()) as {
    data?: {
      id?: string
      name?: string
      context_length?: number
      pricing?: { prompt?: string; completion?: string }
      architecture?: { input_modalities?: string[]; modality?: string }
    }[]
  }

  const out: ModelInfo[] = []
  for (const m of data.data ?? []) {
    if (!m.id) continue

    // 只要能处理文本输入的模型
    const modality = m.architecture?.modality ?? ''
    const inputs = m.architecture?.input_modalities ?? []
    if (modality && !/text/.test(modality) && !inputs.includes('text')) continue

    const promptPrice = Number(m.pricing?.prompt ?? '1')
    const completionPrice = Number(m.pricing?.completion ?? '1')
    const free = m.id.endsWith(':free') || (promptPrice === 0 && completionPrice === 0)

    out.push({
      id: m.id,
      label: m.name || m.id,
      contextLength: m.context_length ?? null,
      free,
      note: free
        ? undefined
        : Number.isFinite(promptPrice) && promptPrice > 0
          ? `$${(promptPrice * 1_000_000).toFixed(2)}/M tokens`
          : undefined,
    })
  }

  // 免费的排前面，方便白嫖
  return dedupe(out).sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1
    return a.label.localeCompare(b.label)
  })
}

function dedupe(list: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  return list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
}

/**
 * Gemini 的排序：flash 类优先（便宜、快、够用），再按名字。
 * 带 preview / exp 的往后排 —— 它们可能随时下线。
 */
function byPreferredOrder(a: ModelInfo, b: ModelInfo): number {
  const rank = (m: ModelInfo) => {
    if (/preview|exp|experimental/i.test(m.id)) return 3
    if (/flash-lite/i.test(m.id)) return 1
    if (/flash/i.test(m.id)) return 0
    if (/pro/i.test(m.id)) return 2
    return 2
  }
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  // 同类里版本号大的排前面
  return b.id.localeCompare(a.id, undefined, { numeric: true })
}

/** 供 UI 搜索用 */
export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  const q = query.trim().toLowerCase()
  if (!q) return models
  return models.filter(
    (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
  )
}

export function formatContext(n: number | null): string {
  if (!n) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M ctx`
  if (n >= 1000) return `${Math.round(n / 1000)}K ctx`
  return `${n} ctx`
}
