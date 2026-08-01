/**
 * 掌纹提取管线。跑在 Worker 里 —— 主线程不能被 Gabor 卷积卡住。
 *
 * 管线：
 *   ① 归一化后的掌图（512×512，由主线程做完透视校正传入）
 *   ② 取绿通道（皮肤褶皱在绿通道对比度最好）
 *   ③ CLAHE 局部对比增强
 *   ④ Gabor 滤波器组，8 方向取最大响应（掌纹是暗谷，已取负）
 *   ⑤ 自适应阈值二值化
 *   ⑥ 闭运算桥接断口 + 移除小连通域
 *   ⑦ Zhang-Suen 细化成 1px 骨架
 *   ⑧ 追踪成折线 + 合并共线段
 */

import {
  adaptiveThreshold,
  clahe,
  close,
  gaborMaxResponse,
  removeSmallComponents,
  thin,
  toGray,
  DEFAULT_GABOR,
} from '@/cv/index'
import { mergeCollinear, traceSkeleton, type Polyline } from '@/cv/trace'

export interface PalmLineRequest {
  id: number
  /** 已经透视校正到标准画布的掌图 */
  image: ImageData
}

export interface PalmLineResponse {
  id: number
  ok: true
  lines: Polyline[]
  /** Gabor 响应图，供后续度量线的深浅 */
  response: Float32Array
  ms: number
}

export interface PalmLineError {
  id: number
  ok: false
  error: string
}

self.onmessage = (e: MessageEvent<PalmLineRequest>) => {
  const { id, image } = e.data
  const t0 = performance.now()

  try {
    const gray = toGray(image, 'green')
    const equalized = clahe(gray, 8, 2.0)
    const response = gaborMaxResponse(equalized, DEFAULT_GABOR)

    const bin = adaptiveThreshold(response, 15, 0.35)
    const closed = close(bin, image.width, image.height, 1)
    const cleaned = removeSmallComponents(closed, image.width, image.height, 40)
    const skeleton = thin(cleaned, image.width, image.height)

    const traced = traceSkeleton(skeleton, image.width, image.height)
    const lines = mergeCollinear(traced, 12, 25)
      // 太短的段留着只会干扰归类
      .filter((l) => l.length > image.width * 0.08)
      .sort((a, b) => b.length - a.length)
      .slice(0, 24)

    const msg: PalmLineResponse = {
      id,
      ok: true,
      lines,
      response: response.data,
      ms: Math.round(performance.now() - t0),
    }
    ;(self as unknown as Worker).postMessage(msg, [response.data.buffer])
  } catch (err) {
    const msg: PalmLineError = {
      id,
      ok: false,
      error: err instanceof Error ? err.message : '掌纹提取失败',
    }
    ;(self as unknown as Worker).postMessage(msg)
  }
}
