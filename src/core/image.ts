/**
 * 图像载入与预处理。
 *
 * ⚠️ 隐私红线：这里是照片进入应用的唯一入口。
 * 必须剥离全部 EXIF（含 GPS）—— 即使照片不上传，也不能让地理位置进入
 * 任何可导出的内存对象。剥离方式是重绘到 canvas：canvas 输出天然不含 EXIF。
 */

/** 长边上限。保证检测精度的同时控制内存（4000px 的原图解码要 60MB+） */
export const MAX_EDGE = 1920

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  /** 仅当前会话内预览用，reset 时 revokeObjectURL */
  previewUrl: string
}

/**
 * File → ImageBitmap，顺带做三件事：
 *   1. 按 EXIF Orientation 摆正
 *   2. 重绘剥离全部 EXIF
 *   3. 长边超过 MAX_EDGE 时等比缩放
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('这不是一张图片')
  }

  // imageOrientation: 'from-image' 让浏览器按 EXIF 自动摆正
  let src: ImageBitmap
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('图片读不出来，换一张试试')
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(src.width, src.height))
  const width = Math.round(src.width * scale)
  const height = Math.round(src.height * scale)

  // 重绘到 canvas —— 这一步同时完成缩放与 EXIF 剥离
  const { canvas, ctx } = makeCanvas2D(width, height)
  ctx.drawImage(src, 0, 0, width, height)
  src.close()

  const bitmap = await createImageBitmap(canvas as never)
  const previewUrl = await canvasToObjectUrl(canvas)

  return { bitmap, width, height, previewUrl }
}

/**
 * 连拍：同一机位、同一角度，短时间内抓若干帧。
 *
 * 目的不是拿新信息（那是多角度的事），而是把逐帧都在变的噪声平均掉 ——
 * 传感器噪声、微动模糊、一瞬间的表情、自动曝光浮动、关键点检测器自身的抖动。
 * 详见 core/frames.ts。
 *
 * 帧全部留在内存里，用完由调用方 close()；和单张一样不落盘、不上传。
 */
export async function captureVideoBurst(
  video: HTMLVideoElement,
  count = 5,
  gapMs = 120,
): Promise<{ bitmaps: ImageBitmap[]; previewUrl: string; width: number; height: number }> {
  const sw = video.videoWidth
  const sh = video.videoHeight
  if (!sw || !sh) throw new Error('相机还没准备好')

  const scale = Math.min(1, MAX_EDGE / Math.max(sw, sh))
  const width = Math.round(sw * scale)
  const height = Math.round(sh * scale)

  const bitmaps: ImageBitmap[] = []
  let previewUrl = ''

  for (let i = 0; i < count; i++) {
    const { canvas, ctx } = makeCanvas2D(width, height)
    ctx.drawImage(video, 0, 0, width, height)
    bitmaps.push(await createImageBitmap(canvas as never))
    // 第一帧同时用作预览
    if (i === 0) previewUrl = await canvasToObjectUrl(canvas)
    if (i < count - 1) await new Promise((r) => setTimeout(r, gapMs))
  }

  return { bitmaps, previewUrl, width, height }
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas
type Any2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * OffscreenCanvas 优先（不占 DOM、可进 Worker），不支持时回落 <canvas>。
 * 两者的 getContext('2d') 返回类型不同，这里统一收窄一次，调用方不必各自处理。
 */
function makeCanvas2D(
  w: number,
  h: number,
  opts?: CanvasRenderingContext2DSettings,
): { canvas: AnyCanvas; ctx: Any2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d', opts)
    if (!ctx) throw new Error('浏览器不支持 Canvas 2D')
    return { canvas, ctx }
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', opts)
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D')
  return { canvas, ctx }
}

async function canvasToObjectUrl(canvas: AnyCanvas): Promise<string> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
      : await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('导出预览失败'))),
            'image/jpeg',
            0.9,
          ),
        )
  return URL.createObjectURL(blob)
}

/** 取 ImageData 供 CV 管线与气色采样使用 */
export function toImageData(bitmap: ImageBitmap): ImageData {
  const { ctx } = makeCanvas2D(bitmap.width, bitmap.height, { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
}

/** 清晰度：Laplacian 方差。< 40 判为过糊直接拒绝，< 100 降置信度。 */
export function sharpnessScore(img: ImageData, sampleStep = 2): number {
  const { data, width, height } = img
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }

  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < height - 1; y += sampleStep) {
    for (let x = 1; x < width - 1; x += sampleStep) {
      const i = y * width + x
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]
      sum += lap
      sumSq += lap * lap
      n++
    }
  }
  if (n === 0) return 0
  const mean = sum / n
  return sumSq / n - mean * mean
}

/** 平均亮度（0–255），用于过暗/过亮判断 */
export function meanLuminance(img: ImageData, sampleStep = 4): number {
  const { data, width, height } = img
  let sum = 0
  let n = 0
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      n++
    }
  }
  return n ? sum / n : 0
}
