/**
 * AI 供应商抽象。切换模型只改配置，不改调用方。
 * 这一层也是挂 core/guard.ts 后置校验的天然位置。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GenerateOptions {
  temperature?: number
  maxOutputTokens?: number
  signal?: AbortSignal
}

export interface AIProvider {
  readonly id: string
  readonly model: string
  /** 流式生成。逐段 yield 文本增量 */
  stream(messages: ChatMessage[], opts?: GenerateOptions): AsyncIterable<string>
}

export class AIError extends Error {
  readonly kind: 'auth' | 'rate_limit' | 'network' | 'refused' | 'unknown'
  readonly retryable: boolean

  constructor(kind: AIError['kind'], message: string) {
    super(message)
    this.name = 'AIError'
    this.kind = kind
    this.retryable = kind === 'rate_limit' || kind === 'network'
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof AIError) {
    switch (e.kind) {
      case 'auth':
        return 'API Key 好像不对，去设置页检查一下'
      case 'rate_limit':
        return '请求太频繁了，等一会儿再试'
      case 'network':
        return '网络没连上，检查一下网络再重试'
      case 'refused':
        return '这次模型没有生成内容，换个问法或稍后再试'
      default:
        return e.message
    }
  }
  if (e instanceof Error && e.name === 'AbortError') return '已取消'
  return e instanceof Error ? e.message : '出了点问题，再试一次'
}

/**
 * 超时。原来一个都没有 —— fetch 不带超时，读流也不带，
 * 于是连接一旦卡住（切网、代理吞包、服务端开了流又不发数据），
 * 界面就永远停在「正在推演」或者追问按钮的「…」上，既不报错也不结束。
 */
export const CONNECT_TIMEOUT_MS = 30_000
/** 流中途多久没有新字节就判定为卡死 */
export const STALL_TIMEOUT_MS = 45_000

/**
 * 把外部 signal 和一个超时合成一个。
 * 不用 AbortSignal.any —— Safari 17 以下没有，而这是个装在手机上的 PWA。
 */
export function withTimeout(
  external: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const ac = new AbortController()
  let timedOut = false

  const onExternalAbort = () => ac.abort()
  if (external) {
    if (external.aborted) ac.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  const timer = setTimeout(() => {
    timedOut = true
    ac.abort()
  }, ms)

  return {
    signal: ac.signal,
    cleanup: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    },
    timedOut: () => timedOut,
  }
}

/** SSE 行解析：把 fetch 的字节流切成 data: 行 */
export async function* sseLines(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) throw new AIError('network', '响应没有内容')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

      // 读一段，同时盯着「多久没有新字节」—— 只靠 signal 是等不到的
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      const stalled = new Promise<never>((_, reject) => {
        stallTimer = setTimeout(
          () => reject(new AIError('network', '连接中断了，网络恢复后重试一次')),
          STALL_TIMEOUT_MS,
        )
      })

      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await Promise.race([reader.read(), stalled])
      } finally {
        clearTimeout(stallTimer)
      }

      if (chunk.done) break
      buf += decoder.decode(chunk.value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (t.startsWith('data:')) yield t.slice(5).trim()
      }
    }
    if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim()
  } finally {
    // 卡死时 cancel 才能真正放掉底层连接，只 releaseLock 是不够的
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function mapHttpError(status: number, body: string): AIError {
  if (status === 401 || status === 403) return new AIError('auth', `认证失败（${status}）`)
  if (status === 429) return new AIError('rate_limit', '超出速率限制')
  if (status >= 500) return new AIError('network', `服务端错误（${status}）`)
  return new AIError('unknown', `请求失败（${status}）：${body.slice(0, 200)}`)
}
