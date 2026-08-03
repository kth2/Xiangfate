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
  choices?: { delta?: { content?: string }; finish_reason?: string }[]
  error?: { message?: string }
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
            // OpenRouter 用这两个头做用量归属统计
            'HTTP-Referer': location.origin,
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

      let emitted = false
      for await (const data of sseLines(res, opts.signal)) {
        if (!data || data === '[DONE]') continue
        let chunk: ORChunk
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        if (chunk.error?.message) throw new AIError('unknown', chunk.error.message)
        const text = chunk.choices?.[0]?.delta?.content ?? ''
        if (text) {
          emitted = true
          yield text
        }
      }

      if (!emitted) throw new AIError('refused', '模型没有返回内容')
    },
  }
}
