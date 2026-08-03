/**
 * 两家供应商的「没有正文」分支。
 *
 * 起因：Gemini 好好的，换到 OpenRouter 的某个推理型免费模型就一律报
 * 「这次模型没有生成内容，换个问法或稍后再试」。
 * 真实原因是模型把额度全用在 reasoning 上、content 一直是空 ——
 * 而那句话让人以为是问法的问题，于是一直换问法、一直失败。
 * 这组用例锁住：**空输出必须说得出原因**。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeminiProvider } from '../gemini'
import { createOpenRouterProvider } from '../openrouter'
import { AIError } from '../provider'

function sseResponse(events: unknown[]): Response {
  const enc = new TextEncoder()
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
        c.close()
      },
    }),
  } as unknown as Response
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => payload,
  } as unknown as Response
}

function stubFetch(res: Response) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
}

async function collect(it: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const d of it) out += d
  return out
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenRouter', () => {
  const provider = () => createOpenRouterProvider('k', 'ling3.0-flash:free')

  it('正常流式照常工作', async () => {
    stubFetch(sseResponse([
      { choices: [{ delta: { content: '三停' } }] },
      { choices: [{ delta: { content: '匀称。' } }] },
    ]))
    expect(await collect(provider().stream([{ role: 'user', content: 'x' }]))).toBe('三停匀称。')
  })

  it('只吐 reasoning、没有正文 → 说清是推理模型把额度用光了', async () => {
    stubFetch(sseResponse([
      { choices: [{ delta: { reasoning: '让我想想……' } }] },
      { choices: [{ delta: { reasoning_content: '还在想……' }, finish_reason: 'length' }] },
    ]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err).toBeInstanceOf(AIError)
    expect(err.message).toContain('思考过程')
    expect(err.message).toContain('ling3.0-flash:free')
    // 不能再是那句会把人带偏的「换个问法」
    expect(err.message).not.toContain('换个问法')
  })

  it('被长度截断 → 明说是长度上限', async () => {
    stubFetch(sseResponse([{ choices: [{ delta: {}, finish_reason: 'length' }] }]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toContain('长度上限')
  })

  it('内容过滤 → 明说是过滤', async () => {
    stubFetch(sseResponse([{ choices: [{ delta: {}, finish_reason: 'content_filter' }] }]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toContain('内容过滤')
  })

  it('什么原因都没有 → 至少点名模型，并提示免费模型会排队', async () => {
    stubFetch(sseResponse([{ choices: [{ delta: {} }] }]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toContain('ling3.0-flash:free')
    expect(err.message).toContain('限流')
  })

  it('流中途的 error 事件照常抛出原文', async () => {
    stubFetch(sseResponse([{ error: { message: 'Rate limit exceeded' } }]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toBe('Rate limit exceeded')
  })

  it('不支持流式、直接回整个 JSON 的模型也能用', async () => {
    stubFetch(jsonResponse({ choices: [{ message: { content: '一次性返回的正文' } }] }))
    expect(await collect(provider().stream([{ role: 'user', content: 'x' }]))).toBe('一次性返回的正文')
  })

  it('HTTP 200 但体里是 error → 把真实原因说出来', async () => {
    stubFetch(jsonResponse({ error: { message: 'No endpoints found matching your data policy' } }))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toContain('data policy')
  })
})

describe('Gemini', () => {
  const provider = () => createGeminiProvider('k', 'gemini-test')

  it('正常流式照常工作', async () => {
    stubFetch(sseResponse([{ candidates: [{ content: { parts: [{ text: '好' }] } }] }]))
    expect(await collect(provider().stream([{ role: 'user', content: 'x' }]))).toBe('好')
  })

  it('MAX_TOKENS 空输出 → 明说是长度', async () => {
    stubFetch(sseResponse([{ candidates: [{ finishReason: 'MAX_TOKENS' }] }]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toContain('长度上限')
  })

  it('SAFETY 空输出 → 明说是安全过滤', async () => {
    stubFetch(sseResponse([{ candidates: [{ finishReason: 'SAFETY' }] }]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toContain('安全过滤')
  })

  it('promptFeedback 拦截照常抛出', async () => {
    stubFetch(sseResponse([{ promptFeedback: { blockReason: 'OTHER' } }]))
    const err = await collect(provider().stream([{ role: 'user', content: 'x' }])).catch((e) => e)
    expect(err.message).toContain('OTHER')
  })
})
