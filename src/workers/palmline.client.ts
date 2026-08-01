/**
 * 掌纹 Worker 的主线程封装。单例 Worker + 请求 id 配对。
 */

import type { Polyline } from '@/cv/trace'
import type { PalmLineError, PalmLineResponse } from './palmline.worker'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  { resolve: (r: { lines: Polyline[]; response: Float32Array; ms: number }) => void; reject: (e: Error) => void }
>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./palmline.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<PalmLineResponse | PalmLineError>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) {
        p.resolve({ lines: e.data.lines, response: e.data.response, ms: e.data.ms })
      } else {
        p.reject(new Error(e.data.error))
      }
    }
    worker.onerror = () => {
      for (const p of pending.values()) p.reject(new Error('掌纹提取线程出错'))
      pending.clear()
    }
  }
  return worker
}

export function extractPalmLines(
  image: ImageData,
  timeoutMs = 20000,
): Promise<{ lines: Polyline[]; response: Float32Array; ms: number }> {
  const w = getWorker()
  const id = nextId++

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('掌纹提取超时，换一张光线柔和些的照片试试'))
    }, timeoutMs)

    pending.set(id, {
      resolve: (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })

    w.postMessage({ id, image })
  })
}

export function terminatePalmWorker(): void {
  worker?.terminate()
  worker = null
  pending.clear()
}
