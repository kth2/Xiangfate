/**
 * MediaPipe 检测器的懒加载与缓存。
 *
 * 三个模型共约 17MB，绝不能在首屏一起下。策略：
 *   · 用户选了哪种相术，才下那个模型
 *   · Service Worker 用 CacheFirst 持久化（见 vite.config.ts），二次打开 < 300ms
 *   · 同一模型并发请求共享同一个 Promise，不会重复下载
 */

import type {
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
  FilesetResolver as FilesetResolverType,
} from '@mediapipe/tasks-vision'
import type { DetectorKind } from '@/core/registry'

const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models'

export const MODEL_URLS: Record<DetectorKind, string> = {
  face: `${MODEL_BASE}/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`,
  hand: `${MODEL_BASE}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`,
  pose: `${MODEL_BASE}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`,
}

/** 实测大小（2026-08-01），用于下载进度与「约 N MB」提示 */
export const MODEL_BYTES: Record<DetectorKind, number> = {
  face: 3_758_596,
  hand: 7_819_105,
  pose: 5_777_746,
}

export interface LoadProgress {
  detector: DetectorKind
  /** 0–1；无法获知总长度时为 null（走的是不确定进度条） */
  ratio: number | null
  phase: 'wasm' | 'model' | 'init' | 'done'
}

export type ProgressHandler = (p: LoadProgress) => void

type Detector = FaceLandmarker | HandLandmarker | PoseLandmarker

const cache = new Map<DetectorKind, Promise<Detector>>()
let filesetPromise: Promise<FilesetResolverType extends never ? never : object> | null = null

/**
 * wasm 运行时由 scripts/copy-mediapipe-wasm.mjs 复制到 public/mediapipe/wasm，
 * 从本站自己的域名加载，不走第三方 CDN —— 这样离线可用，也不受 CDN 可用性影响。
 */
export const WASM_BASE = `${import.meta.env.BASE_URL}mediapipe/wasm`.replace(/\/{2,}/g, '/')

async function getFileset(onProgress?: ProgressHandler, detector?: DetectorKind) {
  if (!filesetPromise) {
    filesetPromise = (async () => {
      onProgress?.({ detector: detector ?? 'face', ratio: null, phase: 'wasm' })
      const { FilesetResolver } = await import('@mediapipe/tasks-vision')
      return FilesetResolver.forVisionTasks(WASM_BASE)
    })()
  }
  return filesetPromise
}

/** 带进度的模型下载。SW 命中缓存时会瞬间完成。 */
async function fetchModel(
  kind: DetectorKind,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const res = await fetch(MODEL_URLS[kind], { signal })
  if (!res.ok) throw new Error(`模型下载失败（HTTP ${res.status}）`)

  const total = Number(res.headers.get('content-length')) || MODEL_BYTES[kind]

  if (!res.body) {
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onProgress?.({
      detector: kind,
      ratio: total ? Math.min(1, received / total) : null,
      phase: 'model',
    })
  }

  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

async function create(
  kind: DetectorKind,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<Detector> {
  const [vision, fileset, modelBuffer] = await Promise.all([
    import('@mediapipe/tasks-vision'),
    getFileset(onProgress, kind),
    fetchModel(kind, onProgress, signal),
  ])

  onProgress?.({ detector: kind, ratio: 1, phase: 'init' })

  // GPU 优先；不支持时回落 CPU（部分安卓 WebView / 老 iOS）
  const delegate = (await supportsWebGL2()) ? 'GPU' : 'CPU'
  const baseOptions = { modelAssetBuffer: modelBuffer, delegate } as const

  let detector: Detector
  switch (kind) {
    case 'face':
      detector = await vision.FaceLandmarker.createFromOptions(fileset as never, {
        baseOptions,
        runningMode: 'IMAGE',
        numFaces: 1,
        // 面相需要虹膜点（468–477）判断眼神清明，以及姿态矩阵做质量门控
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      })
      break
    case 'hand':
      detector = await vision.HandLandmarker.createFromOptions(fileset as never, {
        baseOptions,
        runningMode: 'IMAGE',
        numHands: 1,
      })
      break
    case 'pose':
      detector = await vision.PoseLandmarker.createFromOptions(fileset as never, {
        baseOptions,
        runningMode: 'IMAGE',
        numPoses: 1,
        // 体相所有比例一律用 worldLandmarks（米制），与相机距离无关
        outputSegmentationMasks: false,
      })
      break
  }

  onProgress?.({ detector: kind, ratio: 1, phase: 'done' })
  return detector
}

export function getDetector(
  kind: DetectorKind,
  onProgress?: ProgressHandler,
  signal?: AbortSignal,
): Promise<Detector> {
  const hit = cache.get(kind)
  if (hit) return hit

  const p = create(kind, onProgress, signal).catch((err) => {
    // 失败不能留在缓存里，否则重试永远拿到同一个 rejected promise
    cache.delete(kind)
    throw err
  })
  cache.set(kind, p)
  return p
}

export const getFaceLandmarker = (p?: ProgressHandler, s?: AbortSignal) =>
  getDetector('face', p, s) as Promise<FaceLandmarker>
export const getHandLandmarker = (p?: ProgressHandler, s?: AbortSignal) =>
  getDetector('hand', p, s) as Promise<HandLandmarker>
export const getPoseLandmarker = (p?: ProgressHandler, s?: AbortSignal) =>
  getDetector('pose', p, s) as Promise<PoseLandmarker>

/** 释放检测器（离开分析流程时调用，回收 GPU 资源） */
export function releaseDetector(kind: DetectorKind) {
  const p = cache.get(kind)
  cache.delete(kind)
  void p?.then((d) => d.close()).catch(() => {})
}

export function releaseAll() {
  for (const k of [...cache.keys()]) releaseDetector(k)
}

/** 某个模型是否已被 SW 缓存 —— 用于在首页提示「已就绪 / 约 N MB」 */
export async function isModelCached(kind: DetectorKind): Promise<boolean> {
  if (!('caches' in globalThis)) return false
  try {
    const cacheStore = await caches.open('mediapipe-models')
    const hit = await cacheStore.match(MODEL_URLS[kind])
    return Boolean(hit)
  } catch {
    return false
  }
}

let webgl2Support: boolean | null = null
async function supportsWebGL2(): Promise<boolean> {
  if (webgl2Support !== null) return webgl2Support
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas')
    webgl2Support = Boolean((canvas as HTMLCanvasElement).getContext('webgl2'))
  } catch {
    webgl2Support = false
  }
  return webgl2Support
}

/** 合计需要下载的字节数（用于「约 N MB」文案） */
export function totalBytes(kinds: DetectorKind[]): number {
  return kinds.reduce((s, k) => s + MODEL_BYTES[k], 0)
}

export function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
