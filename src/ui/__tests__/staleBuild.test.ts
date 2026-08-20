/**
 * 部署后旧分片失败的处理。
 *
 * 这一段的两个失败方式都很难看：不处理 → 用户看到
 * 「Unexpected Application Error!」+ 堆栈；处理得太急 → 无限刷新。
 * 所以判定与冷却各自可测。
 */

import { describe, expect, it } from 'vitest'
import { isStaleChunkError, shouldAutoReload } from '../staleBuild'

describe('识别分片加载失败', () => {
  it('认得各家浏览器的原话', () => {
    // 用户实际报上来的那条（Chrome/Edge）
    expect(
      isStaleChunkError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://xiangfate.vercel.app/assets/Report-DnLnjiFL.js',
        ),
      ),
    ).toBe(true)
    expect(
      isStaleChunkError(new TypeError('error loading dynamically imported module: /assets/x.js')),
    ).toBe(true)
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true)
  })

  it('认得 name 为 ChunkLoadError 的形态', () => {
    const e = new Error('boom')
    e.name = 'ChunkLoadError'
    expect(isStaleChunkError(e)).toBe(true)
  })

  it('字符串形式的错误也认', () => {
    expect(isStaleChunkError('Failed to fetch dynamically imported module: /a.js')).toBe(true)
  })

  it('别的错误不误判 —— 否则会把真 bug 变成一次刷新', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isStaleChunkError(new Error('NetworkError when attempting to fetch resource.'))).toBe(
      false,
    )
    expect(isStaleChunkError(null)).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
    expect(isStaleChunkError({})).toBe(false)
  })
})

describe('自动重载的冷却', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial))
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      dump: () => Object.fromEntries(map),
    }
  }

  it('第一次允许重载', () => {
    expect(shouldAutoReload(memoryStorage(), 1_000_000)).toBe(true)
  })

  it('冷却期内不再重载 —— 这是防无限刷新的那道闸', () => {
    const s = memoryStorage()
    expect(shouldAutoReload(s, 1_000_000)).toBe(true)
    expect(shouldAutoReload(s, 1_000_000 + 5_000)).toBe(false)
    expect(shouldAutoReload(s, 1_000_000 + 29_000)).toBe(false)
  })

  it('过了冷却期又可以重载 —— 下一次部署不该被上一次挡住', () => {
    const s = memoryStorage()
    expect(shouldAutoReload(s, 1_000_000)).toBe(true)
    expect(shouldAutoReload(s, 1_000_000 + 31_000)).toBe(true)
  })

  it('存进去的标记是可解析的时间戳', () => {
    const s = memoryStorage()
    shouldAutoReload(s, 1_234_567)
    expect(Number(Object.values(s.dump())[0])).toBe(1_234_567)
  })

  it('标记被写坏时按「可以重载」处理，而不是永久卡死', () => {
    const s = memoryStorage({ 'xf:stale-chunk-reloaded-at': 'not-a-number' })
    expect(shouldAutoReload(s, 1_000_000)).toBe(true)
  })
})
