/**
 * 相机开启与就绪判定。
 *
 * 单独成文件的原因：这一段全是时序和浏览器差异，最容易出错，
 * 却又埋在 UI 组件里没法测。抽出来之后 —— 除了真正需要 DOM 的那一步 ——
 * 都能在 node 环境下用假对象跑测试。
 *
 * 拿到的 MediaStream 只接到 <video> 上做取景，不录制、不落盘、不上传。
 */

export type Facing = 'user' | 'environment'

/**
 * 等画面出来的上限。
 * 正常手机 300ms 内就绪；拖到 10 秒仍无画面，多半是被别的 App 占了摄像头，
 * 或系统层面把权限吞了 —— 此时给一句能照做的话，比让用户对着黑屏按快门强。
 */
export const READY_TIMEOUT_MS = 10_000

/** 事件漏发时的兜底轮询间隔（iOS 独立 PWA 里 loadedmetadata 偶尔不来） */
const POLL_MS = 100

/** <video> 上我们真正用到的那几项。抽成接口，测试里喂假对象即可，不必引 jsdom */
export interface VideoLike {
  readonly videoWidth: number
  readonly videoHeight: number
  readonly readyState: number
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** HAVE_METADATA 起才有宽高；两个尺寸都要非零，否则 drawImage 画出来是空的 */
export function isVideoReady(v: VideoLike): boolean {
  return v.readyState >= 1 && v.videoWidth > 0 && v.videoHeight > 0
}

export class CameraTimeoutError extends Error {
  constructor() {
    super('相机迟迟没有画面。检查一下是不是被别的 App 占用了，或者直接从相册选一张。')
    this.name = 'CameraTimeoutError'
  }
}

/**
 * 等到 <video> 真的有画面。
 *
 * @returns true = 就绪；false = 被 abort（组件卸载或用户关了相机），调用方什么都不用做
 * @throws  CameraTimeoutError 超时
 */
export function waitForVideoReady(
  v: VideoLike,
  timeoutMs = READY_TIMEOUT_MS,
  signal?: AbortSignal,
  schedule: {
    setTimeout: typeof setTimeout
    clearTimeout: typeof clearTimeout
    setInterval: typeof setInterval
    clearInterval: typeof clearInterval
  } = globalThis,
): Promise<boolean> {
  if (isVideoReady(v)) return Promise.resolve(true)
  if (signal?.aborted) return Promise.resolve(false)

  return new Promise<boolean>((resolve, reject) => {
    let done = false

    const finish = (fn: () => void) => {
      if (done) return
      done = true
      // 事件、轮询、超时三条路谁先到都要把另外两条拆干净
      for (const e of EVENTS) v.removeEventListener(e, onEvent)
      schedule.clearInterval(poll)
      schedule.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }

    const onEvent = () => {
      if (isVideoReady(v)) finish(() => resolve(true))
    }
    const onAbort = () => finish(() => resolve(false))

    // 事件可能在挂监听之前就发过了，所以下面还有一条轮询兜底
    for (const e of EVENTS) v.addEventListener(e, onEvent)
    signal?.addEventListener('abort', onAbort)
    const poll = schedule.setInterval(onEvent, POLL_MS)
    const timer = schedule.setTimeout(() => finish(() => reject(new CameraTimeoutError())), timeoutMs)

    onEvent()
  })
}

const EVENTS = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize'] as const

/**
 * 相机根本用不了时的原因。返回 null 表示可以试。
 *
 * 单独判一次是因为 http 页面上 `navigator.mediaDevices` 直接是 undefined ——
 * 那会抛 TypeError，落到通用 catch 里就变成一句看不懂的话。
 */
export function cameraUnavailableReason(nav = globalThis.navigator, win = globalThis): string | null {
  if (!nav?.mediaDevices?.getUserMedia) {
    const secure = (win as { isSecureContext?: boolean })?.isSecureContext
    return secure === false
      ? '浏览器只允许 HTTPS 页面开相机。用 https 打开本站，或者从相册选一张。'
      : '这个浏览器不支持网页调用相机，从相册选一张就行。'
  }
  return null
}

/** getUserMedia 的失败原因 → 用户能照做的一句话 */
export function cameraErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '相机权限被拒了。到浏览器设置里给本站开权限，或者从相册选一张。'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return '这台设备上没找到摄像头，从相册选一张吧。'
    case 'NotReadableError':
    case 'TrackStartError':
      return '摄像头被别的 App 占着。关掉它再回来，或者从相册选一张。'
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return '这台设备的摄像头不支持所需的分辨率，从相册选一张吧。'
    case 'AbortError':
      return '相机启动被打断了，再按一次试试。'
    case 'CameraTimeoutError':
      return err instanceof Error ? err.message : '相机迟迟没有画面。'
    default:
      return '打不开相机。从相册选一张同样可以出报告。'
  }
}

/** 首选约束：长边 1920 与 MAX_EDGE 对齐，省掉一次缩放 */
export function constraintsFor(facing: Facing): MediaStreamConstraints {
  return {
    video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
    audio: false,
  }
}

/** 退而求其次：只要一路视频。分辨率低一点也比开不了强 */
export function fallbackConstraints(facing: Facing): MediaStreamConstraints {
  return { video: { facingMode: facing }, audio: false }
}

export function otherFacing(f: Facing): Facing {
  return f === 'user' ? 'environment' : 'user'
}

/**
 * 有几路摄像头。问不出来时返回 0（不支持 enumerateDevices，或调用被拒）。
 *
 * 注意要在拿到权限之后再问：未授权时部分浏览器只报一路，或者干脆给空列表。
 */
export async function countVideoInputs(nav = globalThis.navigator): Promise<number> {
  try {
    if (!nav?.mediaDevices?.enumerateDevices) return 0
    const devices = await nav.mediaDevices.enumerateDevices()
    return devices.filter((d) => d.kind === 'videoinput').length
  } catch {
    return 0
  }
}

/**
 * 要不要给出「翻转」按钮。
 *
 * 恰好一路时才隐藏。**0 表示问不出来，此时宁可显示** ——
 * 按了切不过去只是一句错误提示，而少给这个按钮在双摄手机上就是功能缺失。
 */
export function shouldOfferFlip(videoInputCount: number): boolean {
  return videoInputCount !== 1
}

/** 前摄要镜像（自拍看着才自然），后摄不能镜像。这只影响取景预览，不影响拍下来的图 */
export function mirrorFor(facing: Facing): string {
  return facing === 'user' ? 'scaleX(-1)' : 'none'
}

type GetMedia = (c: MediaStreamConstraints) => Promise<MediaStream>

/**
 * 开相机。首选约束不成就退到最朴素的一档再试一次 ——
 * 部分安卓前摄给不出 1920，硬要就直接 OverconstrainedError。
 */
export async function openCameraStream(
  facing: Facing,
  getMedia: GetMedia = (c) => navigator.mediaDevices.getUserMedia(c),
): Promise<MediaStream> {
  try {
    return await getMedia(constraintsFor(facing))
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') throw err
    return await getMedia(fallbackConstraints(facing))
  }
}
