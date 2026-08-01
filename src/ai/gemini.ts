/**
 * Google Gemini。默认供应商 —— 有免费额度、中文表现好、延迟低。
 * 用 REST + SSE，不引 SDK（省下约 200KB，且我们只用到一个端点）。
 */

import {
  AIError,
  mapHttpError,
  sseLines,
  type AIProvider,
  type ChatMessage,
  type GenerateOptions,
} from './provider'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiPart {
  text?: string
}
interface GeminiChunk {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
}

export function createGeminiProvider(apiKey: string, model: string): AIProvider {
  return {
    id: 'gemini',
    model,
    async *stream(messages: ChatMessage[], opts: GenerateOptions = {}) {
      const system = messages.find((m) => m.role === 'system')
      const rest = messages.filter((m) => m.role !== 'system')

      const body = {
        ...(system ? { systemInstruction: { parts: [{ text: system.content }] } } : {}),
        contents: rest.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          topP: 0.9,
          maxOutputTokens: opts.maxOutputTokens ?? 2048,
        },
      }

      let res: Response
      try {
        res = await fetch(
          `${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: opts.signal,
          },
        )
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') throw e
        throw new AIError('network', '连不上 Gemini 服务')
      }

      if (!res.ok) throw mapHttpError(res.status, await res.text().catch(() => ''))

      let emitted = false
      for await (const data of sseLines(res, opts.signal)) {
        if (!data || data === '[DONE]') continue
        let chunk: GeminiChunk
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        if (chunk.promptFeedback?.blockReason) {
          throw new AIError('refused', `请求被拦截（${chunk.promptFeedback.blockReason}）`)
        }
        const text = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
        if (text) {
          emitted = true
          yield text
        }
      }

      if (!emitted) throw new AIError('refused', '模型没有返回内容')
    },
  }
}
