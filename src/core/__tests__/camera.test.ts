/**
 * 相机就绪判定的测试。
 *
 * 这一组存在的理由很具体：线上出过一次「打开相机后一直显示相机还没准备好」，
 * 根因是流在 React 提交之前就去接 videoRef，接了个 null。
 * 接流那一步归 effect 管（组件里），但**判定何时算有画面**这一半可以在这里锁死。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  CameraTimeoutError,
  cameraErrorMessage,
  cameraUnavailableReason,
  constraintsFor,
  countVideoInputs,
  fallbackConstraints,
  isVideoReady,
  mirrorFor,
  openCameraStream,
  otherFacing,
  shouldOfferFlip,
  READY_TIMEOUT_MS,
  waitForVideoReady,
  type VideoLike,
} from '../camera'

/** 假的 <video>：可以手动推进到「有画面」，并记录监听器有没有被拆干净 */
function fakeVideo(init: Partial<{ w: number; h: number; state: number }> = {}) {
  const listeners = new Map<string, Set<() => void>>()
  const v = {
    videoWidth: init.w ?? 0,
    videoHeight: init.h ?? 0,
    readyState: init.state ?? 0,
    addEventListener(t: string, fn: () => void) {
      if (!listeners.has(t)) listeners.set(t, new Set())
      listeners.get(t)!.add(fn)
    },
    removeEventListener(t: string, fn: () => void) {
      listeners.get(t)?.delete(fn)
    },
  }
  return {
    video: v as VideoLike,
    /** 模拟 loadedmetadata 到达 */
    arrive(w = 1280, h = 720) {
      v.videoWidth = w
      v.videoHeight = h
      v.readyState = 1
      for (const fn of listeners.get('loadedmetadata') ?? []) fn()
    },
    /** 尺寸出现但不发事件 —— iOS 独立 PWA 里遇到过，靠轮询兜底 */
    arriveSilently(w = 1280, h = 720) {
      v.videoWidth = w
      v.videoHeight = h
      v.readyState = 1
    },
    listenerCount: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  }
}

describe('isVideoReady', () => {
  it('readyState 到位但宽高还是 0 → 不算就绪', () => {
    expect(isVideoReady(fakeVideo({ state: 1 }).video)).toBe(false)
  })

  it('有宽高但 readyState 是 0 → 不算就绪', () => {
    expect(isVideoReady(fakeVideo({ w: 1280, h: 720, state: 0 }).video)).toBe(false)
  })

  it('高为 0 也不算 —— drawImage 会画出空图', () => {
    expect(isVideoReady(fakeVideo({ w: 1280, h: 0, state: 1 }).video)).toBe(false)
  })

  it('三项齐了才算', () => {
    expect(isVideoReady(fakeVideo({ w: 1280, h: 720, state: 1 }).video)).toBe(true)
  })
})

describe('waitForVideoReady', () => {
  it('已经有画面时立即返回，不挂任何监听', async () => {
    const f = fakeVideo({ w: 640, h: 480, state: 4 })
    await expect(waitForVideoReady(f.video)).resolves.toBe(true)
    expect(f.listenerCount()).toBe(0)
  })

  it('等到 loadedmetadata 才返回', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeVideo()
      const p = waitForVideoReady(f.video)
      f.arrive()
      await expect(p).resolves.toBe(true)
      expect(f.listenerCount(), '监听器要拆干净').toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('事件漏发也能靠轮询救回来', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeVideo()
      const p = waitForVideoReady(f.video)
      f.arriveSilently()
      await vi.advanceTimersByTimeAsync(200)
      await expect(p).resolves.toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('超时抛 CameraTimeoutError，而不是一直吊着', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeVideo()
      const p = waitForVideoReady(f.video, 1000)
      const assertion = expect(p).rejects.toBeInstanceOf(CameraTimeoutError)
      await vi.advanceTimersByTimeAsync(1100)
      await assertion
      expect(f.listenerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('abort 后返回 false —— 调用方据此什么都不做，不弹错误', async () => {
    vi.useFakeTimers()
    try {
      const f = fakeVideo()
      const ac = new AbortController()
      const p = waitForVideoReady(f.video, 5000, ac.signal)
      ac.abort()
      await expect(p).resolves.toBe(false)
      expect(f.listenerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('传入已 abort 的 signal 直接返回 false', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(waitForVideoReady(fakeVideo().video, 5000, ac.signal)).resolves.toBe(false)
  })

  it('超时上限是 10 秒 —— 比这更长，用户已经在对着黑屏发呆了', () => {
    expect(READY_TIMEOUT_MS).toBe(10_000)
  })
})

describe('cameraUnavailableReason', () => {
  it('http 页面上 mediaDevices 是 undefined → 明说要 HTTPS', () => {
    const r = cameraUnavailableReason(undefined as never, { isSecureContext: false } as never)
    expect(r).toContain('HTTPS')
  })

  it('安全上下文里仍然没有 → 是浏览器不支持，别误导成协议问题', () => {
    const r = cameraUnavailableReason(undefined as never, { isSecureContext: true } as never)
    expect(r).toContain('不支持')
    expect(r).not.toContain('HTTPS')
  })

  it('能用时返回 null', () => {
    const nav = { mediaDevices: { getUserMedia: () => {} } } as never
    expect(cameraUnavailableReason(nav, {} as never)).toBeNull()
  })

  it('无论哪种情形都给出相册这条退路', () => {
    for (const secure of [true, false]) {
      expect(cameraUnavailableReason(undefined as never, { isSecureContext: secure } as never)).toContain(
        '相册',
      )
    }
  })
})

describe('cameraErrorMessage', () => {
  const named = (name: string) => Object.assign(new Error('x'), { name })

  it.each([
    ['NotAllowedError', '权限'],
    ['NotFoundError', '摄像头'],
    ['NotReadableError', '占着'],
    ['OverconstrainedError', '分辨率'],
  ])('%s 给出对症的一句', (name, needle) => {
    expect(cameraErrorMessage(named(name))).toContain(needle)
  })

  it('认不出的错也不说黑话，并指向相册', () => {
    expect(cameraErrorMessage(new Error('boom'))).toContain('相册')
  })

  it('超时错保留自己的原文', () => {
    expect(cameraErrorMessage(new CameraTimeoutError())).toContain('迟迟没有画面')
  })
})

describe('前后摄切换', () => {
  it('otherFacing 来回切', () => {
    expect(otherFacing('user')).toBe('environment')
    expect(otherFacing('environment')).toBe('user')
  })

  it('恰好一路摄像头时不给翻转按钮', () => {
    expect(shouldOfferFlip(1)).toBe(false)
  })

  it('两路及以上给', () => {
    expect(shouldOfferFlip(2)).toBe(true)
    expect(shouldOfferFlip(3)).toBe(true)
  })

  it('问不出来（0）时也给 —— 少给按钮是功能缺失，多给只是一句错误提示', () => {
    expect(shouldOfferFlip(0)).toBe(true)
  })

  it('只有前摄要镜像 —— 后摄镜像会让人拍反', () => {
    expect(mirrorFor('user')).toBe('scaleX(-1)')
    expect(mirrorFor('environment')).toBe('none')
  })

  it('countVideoInputs 只数 videoinput', async () => {
    const nav = {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: 'videoinput' },
          { kind: 'audioinput' },
          { kind: 'videoinput' },
          { kind: 'audiooutput' },
        ],
      },
    } as never
    expect(await countVideoInputs(nav)).toBe(2)
  })

  it('enumerateDevices 不存在或抛错时返回 0，而不是让调用方炸掉', async () => {
    expect(await countVideoInputs(undefined as never)).toBe(0)
    const nav = {
      mediaDevices: {
        enumerateDevices: async () => {
          throw new Error('denied')
        },
      },
    } as never
    expect(await countVideoInputs(nav)).toBe(0)
  })
})

describe('openCameraStream', () => {
  it('首选约束成功就用首选', async () => {
    const seen: MediaStreamConstraints[] = []
    const gum = vi.fn(async (c: MediaStreamConstraints) => {
      seen.push(c)
      return {} as MediaStream
    })
    await openCameraStream('user', gum)
    expect(gum).toHaveBeenCalledTimes(1)
    expect(seen[0]).toEqual(constraintsFor('user'))
  })

  it('分辨率给不出时退到朴素约束再试 —— 部分安卓前摄如此', async () => {
    const gum = vi.fn(async (c: MediaStreamConstraints) => {
      if (JSON.stringify(c) === JSON.stringify(constraintsFor('user'))) {
        throw Object.assign(new Error('no'), { name: 'OverconstrainedError' })
      }
      return {} as MediaStream
    })
    await expect(openCameraStream('user', gum)).resolves.toBeDefined()
    expect(gum).toHaveBeenCalledTimes(2)
    expect(gum.mock.calls[1][0]).toEqual(fallbackConstraints('user'))
  })

  it('权限被拒不重试 —— 再问一次也还是拒', async () => {
    const gum = vi.fn(async () => {
      throw Object.assign(new Error('no'), { name: 'NotAllowedError' })
    })
    await expect(openCameraStream('user', gum)).rejects.toThrow()
    expect(gum).toHaveBeenCalledTimes(1)
  })

  it('体相用后摄，其余用前摄', () => {
    expect((constraintsFor('environment').video as MediaTrackConstraints).facingMode).toBe('environment')
    expect((constraintsFor('user').video as MediaTrackConstraints).facingMode).toBe('user')
  })

  it('首选长边与 MAX_EDGE 对齐，省掉一次缩放', async () => {
    const { MAX_EDGE } = await import('../image')
    const v = constraintsFor('user').video as MediaTrackConstraints
    expect((v.width as ConstrainULongRange).ideal).toBe(MAX_EDGE)
  })
})
