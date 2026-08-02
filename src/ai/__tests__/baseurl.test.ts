/**
 * 端点解析。
 *
 * 线上事故的回归测试：设置里 baseUrl 默认是空串，provider 却用函数默认参数
 * 兜底 —— 默认参数只对 undefined 生效。空串一路穿到 fetch，请求地址变成
 * `/models/xxx:streamGenerateContent`（相对路径），打到自己站点上，
 * Vercel rewrite 到 index.html，对静态文件 POST 返回 405。
 * 表现就是「AI 分析报错 405」，而模型列表却正常 —— 因为 models.ts 那边
 * 用的是 `||`，能正确处理空串。
 *
 * 所以这里的核心断言只有一条：不管 baseUrl 传成什么样，
 * 真正发出去的 URL 必须是绝对地址，且不能指向本站。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BASE_URL, normalizeBaseUrl } from '../models'
import { createGeminiProvider } from '../gemini'
import { createOpenRouterProvider } from '../openrouter'

describe('normalizeBaseUrl', () => {
  it('空串 / 空白 / undefined / null 一律回落到默认端点', () => {
    for (const v of ['', '   ', undefined, null]) {
      expect(normalizeBaseUrl('gemini', v)).toBe(DEFAULT_BASE_URL.gemini)
      expect(normalizeBaseUrl('openrouter', v)).toBe(DEFAULT_BASE_URL.openrouter)
    }
  })

  it('默认端点本身是绝对 https 地址', () => {
    for (const url of Object.values(DEFAULT_BASE_URL)) {
      expect(new URL(url).protocol).toBe('https:')
    }
  })

  it('保留用户自填的端点，并去掉尾部斜杠', () => {
    expect(normalizeBaseUrl('gemini', 'https://proxy.example.com/v1beta/')).toBe(
      'https://proxy.example.com/v1beta',
    )
    expect(normalizeBaseUrl('gemini', '  https://proxy.example.com/v1beta  ')).toBe(
      'https://proxy.example.com/v1beta',
    )
  })

  it('相对路径要当场报错，而不是把 Key POST 到本站', () => {
    expect(() => normalizeBaseUrl('gemini', '/v1beta')).toThrow()
    expect(() => normalizeBaseUrl('gemini', 'generativelanguage.googleapis.com')).toThrow()
    expect(() => normalizeBaseUrl('openrouter', 'ftp://x.example.com')).toThrow()
  })
})

/** 拦下 fetch，只为了看请求地址 */
function captureFetch() {
  const calls: { url: string; method?: string }[] = []
  const fake = vi.fn(async (input: unknown, init?: { method?: string }) => {
    calls.push({
      url: input instanceof URL ? input.href : String(input),
      method: init?.method,
    })
    // 流内容不重要，测的是地址；给个空流让生成器自然结束
    return new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 })
  })
  vi.stubGlobal('fetch', fake)
  return calls
}

describe('provider 发出的请求地址', () => {
  let calls: { url: string; method?: string }[]

  beforeEach(() => {
    calls = captureFetch()
    // openrouter 会读 location.origin
    vi.stubGlobal('location', { origin: 'https://xiangfate.vercel.app' })
  })
  afterEach(() => vi.unstubAllGlobals())

  async function drain(it: AsyncIterable<string>) {
    try {
      for await (const _ of it) {
        /* 只跑一遍，触发 fetch */
      }
    } catch {
      /* 空流会抛「模型没有返回内容」，与本测试无关 */
    }
  }

  it('Gemini：baseUrl 为空串时仍打到 googleapis，而不是相对路径', async () => {
    const p = createGeminiProvider('k', 'gemini-2.5-flash', '')
    await drain(p.stream([{ role: 'user', content: 'hi' }]))

    expect(calls).toHaveLength(1)
    const { url, method } = calls[0]
    expect(method).toBe('POST')
    expect(url.startsWith('https://generativelanguage.googleapis.com/')).toBe(true)
    expect(url).toContain('gemini-2.5-flash:streamGenerateContent')
    // 就是这一条：出事那版这里是 /models/...，绝对化之后落在本站
    expect(new URL(url, 'https://xiangfate.vercel.app').origin).not.toBe(
      'https://xiangfate.vercel.app',
    )
  })

  it('OpenRouter：baseUrl 为空串时仍打到 openrouter.ai', async () => {
    const p = createOpenRouterProvider('k', 'deepseek/deepseek-chat-v3.1:free', '')
    await drain(p.stream([{ role: 'user', content: 'hi' }]))

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('自填端点照用', async () => {
    const p = createGeminiProvider('k', 'm', 'https://proxy.example.com/v1beta')
    await drain(p.stream([{ role: 'user', content: 'hi' }]))
    expect(calls[0].url.startsWith('https://proxy.example.com/v1beta/models/')).toBe(true)
  })
})
