/**
 * 手掌归一化：21 个关节点 → 标准掌画布。
 *
 * 左手会先做水平镜像，统一按右手朝向处理 —— 这样掌纹的位置先验
 * 只需要写一套。
 *
 * ⚠️ 用的是**最小二乘仿射**，不是单应。原因写在 cv/homography.ts 的 fitAffine 上：
 * 可用锚点里三个 MCP 近共线，单应在这种配置下病态，实测会把整个大鱼际
 * 甩出画布，并且中指 MCP 抖 2px 就能让画布上的点跑 150px。
 * 矩阵仍是 Matrix3（末行 [0,0,1]），下游的 applyHomography / invertHomography /
 * warpPerspective 一律照旧。
 */

import { fitAffine, warpPerspective, type Matrix3 } from '@/cv/homography'
import type { P2, P3 } from '@/core/geom'
import { CANVAS, CANVAS_ANCHORS, HAND } from './landmarks'

export interface NormalizedPalm {
  /** 标准掌画布上的图像 */
  image: ImageData
  /** 原图 → 标准画布 的单应矩阵 */
  H: Matrix3
  /** 是否做过左右镜像 */
  mirrored: boolean
}

/**
 * @param landmarks 归一化图像坐标（0–1）
 * @param handedness MediaPipe 给的左右手；左手会被镜像
 */
export function normalizePalm(
  src: ImageData,
  landmarks: P3[],
  handedness: 'Left' | 'Right',
): NormalizedPalm {
  const mirrored = handedness === 'Left'

  const toPx = (i: number): P2 => ({
    x: (mirrored ? 1 - landmarks[i].x : landmarks[i].x) * src.width,
    y: landmarks[i].y * src.height,
  })

  const working = mirrored ? mirrorImage(src) : src

  const srcPts = [
    toPx(HAND.indexMcp),
    toPx(HAND.pinkyMcp),
    toPx(HAND.wrist),
    toPx(HAND.middleMcp),
  ]
  const dstPts = [
    CANVAS_ANCHORS.indexMcp,
    CANVAS_ANCHORS.pinkyMcp,
    CANVAS_ANCHORS.wrist,
    CANVAS_ANCHORS.middleMcp,
  ]

  /*
   * 仿射而非单应 —— 见 cv/homography.ts 里 fitAffine 的那段说明。
   * 一句话：四个锚点里有三个（食/中/小指 MCP）挤在指根一线上，
   * 单应在这种配置下是病态的，实测把拇指根甩到画布外 1.7 个身位，
   * 而金星丘与生命线的先验全写在那一块。
   */
  const H = fitAffine(srcPts, dstPts)
  const image = warpPerspective(working, H, CANVAS.W, CANVAS.H)

  return { image, H, mirrored }
}

function mirrorImage(src: ImageData): ImageData {
  const { width, height, data } = src
  const out = new ImageData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4
      const di = (y * width + (width - 1 - x)) * 4
      out.data[di] = data[si]
      out.data[di + 1] = data[si + 1]
      out.data[di + 2] = data[si + 2]
      out.data[di + 3] = data[si + 3]
    }
  }
  return out
}

/** 标准画布坐标 → 比例坐标（0–1），供位置先验使用 */
export const toRatio = (p: P2): P2 => ({ x: p.x / CANVAS.W, y: p.y / CANVAS.H })
