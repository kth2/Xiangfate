/**
 * 超时。原来整条链路一个超时都没有 —— fetch 不带，读流也不带，
 * 于是连接一卡住，界面就永远停在「正在推演」或追问按钮的「…」上。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AIError, sseLines, STALL_TIMEOUT_MS, withTimeout } from '../provider'

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('到点自己 abort，并标记为超时', () => {
    const t = withTimeout(undefined, 1000)
    expect(t.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(t.signal.aborted).toBe(true)
    expect(t.timedOut()).toBe(true)
  })

  it('外部 abort 会传导进来，且不算超时', () => {
    const outer = new AbortController()
    const t = withTimeout(outer.signal, 1000)
    outer.abort()
    expect(t.signal.aborted).toBe(true)
    expect(t.timedOut()).toBe(false)
  })

  it('外部已经 abort 的，立刻同步', () => {
    const outer = new AbortController()
    outer.abort()
    expect(withTimeout(outer.signal, 1000).signal.aborted).toBe(true)
  })

  it('cleanup 之后计时器不再开火 —— 响应头到了就该停表', () => {
    const t = withTimeout(undefined, 1000)
    t.cleanup()
    vi.advanceTimersByTime(5000)
    expect(t.signal.aborted).toBe(false)
    expect(t.timedOut()).toBe(false)
  })
})

describe('sseLines 的停顿看门狗', () => {
  /** 造一个「开了流但一个字节都不发」的响应 —— 正是卡死时的样子 */
  function silentResponse(): Response {
    return {
      body: new ReadableStream<Uint8Array>({ start() { /* 永不 enqueue，也不 close */ } }),
    } as Response
  }

  function chunkedResponse(chunks: string[]): Response {
    const enc = new TextEncoder()
    return {
      body: new ReadableStream<Uint8Array>({
        start(c) {
          for (const s of chunks) c.enqueue(enc.encode(s))
          c.close()
        },
      }),
    } as Response
  }

  it('正常的流照收不误', async () => {
    const out: string[] = []
    for await (const d of sseLines(chunkedResponse(['data: a\n', 'data: b\n']))) out.push(d)
    expect(out).toEqual(['a', 'b'])
  })

  it('最后一行没有换行也不会丢', async () => {
    const out: string[] = []
    for await (const d of sseLines(chunkedResponse(['data: only']))) out.push(d)
    expect(out).toEqual(['only'])
  })

  it('久不来数据就报错退出，而不是无限等下去', async () => {
    vi.useFakeTimers()
    try {
      const iter = sseLines(silentResponse())
      const pending = iter.next()
      const assertion = expect(pending).rejects.toBeInstanceOf(AIError)
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 10)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
