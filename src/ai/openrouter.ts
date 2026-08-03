/**
 * OpenRouter。备选供应商 —— 聚合多家模型，带 :free 后缀的可免费使用。
 * 走 OpenAI 兼容的 chat/completions 接口。
 */

import {
  AIError,
  CONNECT_TIMEOUT_MS,
  mapHttpError,
  sseLines,
  withTimeout,
  type AIProvider,
  type ChatMessage,
  type GenerateOptions,
} from './provider'
import { normalizeBaseUrl } from './models'

interface ORChunk {
  choices?: {
    delta?: {
      content?: string
      /**
       * 推理型模型把「想的过程」放这两个字段，正文才在 content 里。
       * 早先只读 content，于是这类模型一路吐 reasoning、content 始终为空，
       * 最后一律报成「模型没有返回内容」—— 真正的原因（想太久把额度用完了）
       * 被这句话盖掉了。
       */
      reasoning?: string
      reasoning_content?: string
    }
    finish_reason?: string
  }[]
  error?: { message?: string }
}

/** 非流式响应体（部分免费模型不支持 SSE，直接回一整个 JSON） */
interface ORWhole {
  choices?: { message?: { content?: string }; finish_reason?: string }[]
  error?: { message?: string }
}

/**
 * 「没有正文」的原因往往是可以说清楚的，不该一律回一句
 * 「这次模型没有生成内容，换个问法或稍后再试」——
 * 换个问法治不了推理模型把额度想光，用户只会一直换问法一直失败。
 */
function noContent(model: string, finishReason: string | undefined, sawReasoning: boolean): AIError {
  if (sawReasoning) {
    return new AIError(
      'refused',
      `${model} 把输出额度全用在思考过程上了，没写出正文。换一个非推理型的模型更合适（推理模型在这个场景里性价比很低）。`,
    )
  }
  if (finishReason === 'length') {
    return new AIError('refused', `${model} 还没说到正文就被输出长度上限截断了，换个模型试试`)
  }
  if (finishReason === 'content_filter') {
    return new AIError('refused', `${model} 的内容过滤拦下了这次输出，换个问法或换个模型`)
  }
  return new AIError(
    'refused',
    `${model} 这次没有返回任何内容${finishReason ? `（结束原因：${finishReason}）` : ''}。免费模型经常排队或限流，稍后再试或换一个模型。`,
  )
}

export function createOpenRouterProvider(
  apiKey: string,
  model: string,
  baseUrl?: string,
): AIProvider {
  const endpoint = `${normalizeBaseUrl('openrouter', baseUrl)}/chat/completions`

  return {
    id: 'openrouter',
    model,
    async *stream(messages: ChatMessage[], opts: GenerateOptions = {}) {
      // 首字节超时：连不上 / 服务端不响应时不能无限等
      const t = withTimeout(opts.signal, CONNECT_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            // OpenRouter 用这两个头做用量归属统计。
            // location 在 Worker / 非浏览器环境里未必有，取不到就退回站点地址 ——
            // 这一行原来会直接抛 ReferenceError，还被外层包成「连不上 OpenRouter 服务」
            'HTTP-Referer': typeof location === 'undefined' ? 'https://xiangfate.app' : location.origin,
            'X-Title': 'Xiangfate',
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            temperature: opts.temperature ?? 0.7,
            top_p: 0.9,
            max_tokens: opts.maxOutputTokens ?? 2048,
          }),
          signal: t.signal,
        })
      } catch (e) {
        t.cleanup()
        if (t.timedOut()) throw new AIError('network', 'OpenRouter 一直没有响应，超时了')
        if (e instanceof Error && e.name === 'AbortError') throw e
        throw new AIError('network', '连不上 OpenRouter 服务')
      }

      // 响应头已到，首字节计时到此为止；之后由 sseLines 的停顿看门狗接管
      t.cleanup()
      if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''))

      // 有些免费模型压根不支持流式，HTTP 200 直接回一整个 JSON（也可能是 200 带 error 体）。
      // 这种响应里没有一行 data:，走 SSE 解析只会得到「什么都没有」。
      const contentType = res.headers?.get?.('content-type') ?? ''
      if (contentType && !contentType.includes('event-stream')) {
        const whole = (await res.json().catch(() => null)) as ORWhole | null
        if (whole?.error?.message) throw new AIError('unknown', whole.error.message)
        const text = whole?.choices?.[0]?.message?.content
        if (text) {
          yield text
          return
        }
        throw noContent(model, whole?.choices?.[0]?.finish_reason, false)
      }

      let emitted = false
      let sawReasoning = false
      let finishReason: string | undefined
      for await (const data of sseLines(res, opts.signal)) {
        if (!data || data === '[DONE]') continue
        let chunk: ORChunk
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        if (chunk.error?.message) throw new AIError('unknown', chunk.error.message)

        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (choice?.delta?.reasoning || choice?.delta?.reasoning_content) sawReasoning = true

        const text = choice?.delta?.content ?? ''
        if (text) {
          emitted = true
          yield text
        }
      }

      if (!emitted) throw noContent(model, finishReason, sawReasoning)
    },
  }
}
