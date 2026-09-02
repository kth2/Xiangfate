/**
 * 掌图标号。
 *
 * 只做**排版**，不产生任何新判断 —— 每个标号都指回 rules.ts 已经出过的那一项，
 * 靠 featureId 去 envelope.features 里取词。这一层里没有任何一句断语是新写的。
 *
 * 为什么要单独成一个纯函数而不是写在组件里：编号顺序、哪些项该上图、
 * 徽标落在哪，这三件事都值得用测试钉住。画布只负责把算好的位置画出来。
 */

import type { P2 } from '@/core/geom'
import { applyHomography, invertHomography, type Matrix3 } from '@/cv/homography'
import type { MountBand, MountName, PalmLineName } from '@/core/types'
import { CANVAS, MOUNTS, type MountKey } from './landmarks'
import type { LineMeasure } from './palmlines'
import { lineFeatureId, mountFeatureId } from './rules'

export interface PalmMark {
  /** 图上与列表共用的序号，从 1 起 */
  n: number
  name: string
  kind: 'line' | 'mount'
  /** envelope.features 里主项的 id；子项以 `${featureId}.` 开头 */
  featureId: string
  /** 徽标落点（标准画布像素坐标）。null = 未测到，图上不落标号 */
  anchor: P2 | null
  /** 掌线才有：整条折线，供描边 */
  path?: P2[]
}

/**
 * 六条主线的固定顺序。与 rules.ts 的 ALL_LINES 一致，也大致是相书列条的次序。
 * **未测到的线也占一个号**：列表里如实写「未测到」，比悄悄跳过诚实 ——
 * 那张海报十条全给满，正是因为它对谁都说同样的话。
 */
const LINE_ORDER: PalmLineName[] = ['生命线', '智慧线', '感情线', '命运线', '太阳线', '婚姻线']

/** 掌丘上图的门槛：只收偏离中和的。中和的丘没有可说之处，上去只是占位 */
const MOUNT_ORDER: MountKey[] = ['金星丘', '月丘', '木星丘', '太阳丘', '水星丘', '土星丘', '火星丘']

/** 徽标之间的期望间距（标准画布像素）。低于此值就换个落点 */
const MIN_GAP = 56

/** 掌线上允许放徽标的位置，按「离线中点由近及远」排 —— 优先摆在线的中段 */
const ALONG = [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]

export function buildPalmMarks(
  lines: Map<PalmLineName, LineMeasure>,
  mountProfile: Record<MountName, MountBand>,
): PalmMark[] {
  const marks: PalmMark[] = []
  const placed: P2[] = []
  let n = 0

  /**
   * 掌丘先落位：它的中心是固定的，没有挪的余地。
   * 掌线随后再在自己身上挑一个离已有徽标最远的点 —— 这样徽标永远落在它所指的线上，
   * 不会为了避让而飘到别处去，也就不需要引线。
   */
  const mountMarks: PalmMark[] = []
  for (const key of MOUNT_ORDER) {
    const band = mountProfile[key]
    if (band === 'balanced' || band === 'unavailable' || band === undefined) continue
    const anchor = { x: MOUNTS[key].x * CANVAS.W, y: MOUNTS[key].y * CANVAS.H }
    placed.push(anchor)
    mountMarks.push({
      n: 0, // 编号在掌线之后统一补
      name: key,
      kind: 'mount',
      featureId: mountFeatureId(key),
      anchor,
    })
  }

  for (const name of LINE_ORDER) {
    n += 1
    const L = lines.get(name)
    const featureId = lineFeatureId(name)
    if (!L || L.points.length < 2) {
      marks.push({ n, name, kind: 'line', featureId, anchor: null })
      continue
    }
    const anchor = pickAnchor(L.points, placed)
    placed.push(anchor)
    marks.push({ n, name, kind: 'line', featureId, anchor, path: L.points })
  }

  for (const m of mountMarks) marks.push({ ...m, n: (n += 1) })
  return marks
}

/**
 * 在折线上挑一个徽标落点：取离已有徽标最远的那个候选。
 * 都挤不开时也要给出答案（取最优解），宁可稍近也不留空 —— 画布上会看得出来。
 */
function pickAnchor(points: P2[], placed: P2[]): P2 {
  let best = points[Math.floor(points.length / 2)]
  let bestClearance = -1

  for (const f of ALONG) {
    const p = points[Math.min(points.length - 1, Math.round(f * (points.length - 1)))]
    let clearance = Infinity
    for (const q of placed) clearance = Math.min(clearance, Math.hypot(p.x - q.x, p.y - q.y))
    if (clearance === Infinity) return p // 第一个徽标，随便放中点
    if (clearance > bestClearance) {
      bestClearance = clearance
      best = p
    }
    if (clearance >= MIN_GAP) break // 够开了就不必再挑
  }
  return best
}

/* ============================================================
   映回原照片
   ============================================================ */

export interface SourceFrame {
  /** 原图 → 标准画布 的单应矩阵（analyzePalm 给出） */
  H: Matrix3
  /** 左手在归一化之前做过水平镜像 */
  mirrored: boolean
  /** 原照片像素尺寸 */
  srcWidth: number
  srcHeight: number
  /** 展示用图相对原照片的缩放比（把大图缩小了就传这个） */
  scale: number
}

/**
 * 把标准画布坐标的标号映回**原照片**坐标。
 *
 * ── 为什么要映回去 ─────────────────────────────────────
 * 报告页原先直接展示标准掌图。但那张图是单应变换的产物，而这个变换目前是坏的：
 * 实测任何手形下都有 4 个以上关节点被甩出画布，掌根一侧甚至被投到 x = −0.955。
 * 于是用户看到的是一张歪斜、带背景楔形、手掌没框住的图 —— 图没画错，
 * 是它照实画了一个本来就不对的画布。
 *
 * 度量帧不能动（所有掌线先验与丘位都定在它上面，改帧要连带重定标）。
 * 但**给人看的图**没有理由跟度量帧绑在一起。于是把描线用 H⁻¹ 映回原照片，
 * 画在原照片上：
 *   · 描线会精确落回它当初被找到的那些像素 —— 逆变换是严格的，歪不歪都对得上
 *   · 用户看到的是自己那张正常的手掌照，框得住、认得出
 *   · 归一化坏在哪里也就藏不住了，反而更容易看出来
 *
 * 掌丘中心是定义在画布上的比例点，映回去有可能落到手外；那种情况不落标号
 * （返回 anchor = null），宁可不标也不指错地方。
 */
/**
 * 「标准画布 → 原照片」的点映射器。
 *
 * 抽出来是因为报告页与校正界面都要用它。两处各写一遍这段数学，
 * 迟早有一处改了另一处没改 —— 那时候图上画的线和用户点到的线会错开，
 * 而且不报错。
 */
export function sourcePointMapper(frame: SourceFrame): (p: P2) => P2 {
  const Hinv = invertHomography(frame.H)
  return (p: P2): P2 => {
    const q = applyHomography(Hinv, p)
    // 撤掉左手那一次水平镜像，再按展示尺寸缩放
    const x = frame.mirrored ? frame.srcWidth - 1 - q.x : q.x
    return { x: x * frame.scale, y: q.y * frame.scale }
  }
}

export function marksToSourceSpace(marks: PalmMark[], frame: SourceFrame): PalmMark[] {
  const back = sourcePointMapper(frame)

  const W = frame.srcWidth * frame.scale
  const Hh = frame.srcHeight * frame.scale
  const inside = (p: P2): boolean => p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= Hh

  return marks.map((m) => {
    const path = m.path?.map(back)
    const anchor = m.anchor ? back(m.anchor) : null
    return {
      ...m,
      // 映出画面的标号不落 —— 那说明归一化把这一处推到了照片之外
      anchor: anchor && inside(anchor) ? anchor : null,
      ...(path ? { path } : {}),
    }
  })
}

/* ============================================================
   取景：把画面裁到手上，并把手扶正
   ============================================================ */

/**
 * 原照片坐标 → 展示画面坐标 的仿射（与 canvas setTransform 的参数同序）。
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */
export interface HandView {
  width: number
  height: number
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * 留白：按手的长边计。
 *
 * 21 个关键点全是**关节**，掌缘（尤其大鱼际与腕下）都在它们之外，
 * 所以外扩一圈才框得住整只手。
 *
 * ⚠️ 这个 0.16 是我挑的，但它与本项目其他判线不同性质：**只影响取景**，
 * 不参与任何度量、不进任何断语。框松一点框紧一点，读出来的东西一模一样。
 */
const VIEW_PAD = 0.16

/**
 * 依关键点把画面裁到手上，并把手扶正。
 *
 * 与 normalizePalm 的分工要分清楚：
 *   · normalizePalm 做的是**度量帧** —— 单应变换，所有位置先验都定在它上面，
 *     而它目前是坏的（任何手形下都有关节点被甩出画布），正等定标数据。
 *   · 这里做的是**取景** —— 只有旋转、缩放、平移（相似变换），没有透视分量，
 *     因此不存在那种消影线穿过掌面的病态：手绝不会被折过去或甩出画面。
 *
 * 扶正取「腕 → 中指根」这条轴，把它转到竖直向上，与相书掌图的摆法一致，
 * 也与那张参考长图一样。
 */
export function handViewTransform(
  landmarksPx: P2[],
  src: { width: number; height: number },
  maxSide: number,
  pad = VIEW_PAD,
): HandView {
  const wrist = landmarksPx[HAND_VIEW_WRIST]
  const mid = landmarksPx[HAND_VIEW_MIDDLE_MCP]

  // 让「腕 → 中指根」指向正上方（画面 y 向下，故目标角为 −90°）
  const alpha = Math.atan2(mid.y - wrist.y, mid.x - wrist.x)
  const phi = -Math.PI / 2 - alpha
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of landmarksPx) {
    const rx = cos * p.x - sin * p.y
    const ry = sin * p.x + cos * p.y
    minX = Math.min(minX, rx)
    maxX = Math.max(maxX, rx)
    minY = Math.min(minY, ry)
    maxY = Math.max(maxY, ry)
  }

  const m = pad * Math.max(maxX - minX, maxY - minY)
  const box = { x0: minX - m, y0: minY - m, x1: maxX + m, y1: maxY + m }
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2

  /**
   * 取景框必须整个落在原照片之内。
   *
   * ⚠️ 这一条原先漏了：handViewTransform 当时根本不知道照片有多大，
   * 于是「手的包围盒 + 留白」很容易越出照片边界 —— 越出去那片像素
   * drawImage 从来不写，留在画布上就是透明，深色主题下显示为**黑色楔形**。
   * 用户看到的那道斜边，正是原照片被转过来的边。
   *
   * 处理方式是把框按中心等比收小到刚好装得下。手若本来就拍出了画面，
   * 收小会切掉一点手 —— 但那一点本来就没被拍下来，
   * 显示照片里真实存在的部分，比补一片黑要诚实。
   */
  const fits = (t: number): boolean => {
    const hw = ((box.x1 - box.x0) / 2) * t
    const hh = ((box.y1 - box.y0) / 2) * t
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      const rx = cx + sx * hw
      const ry = cy + sy * hh
      // 转回原照片坐标：R(−φ)
      const x = cos * rx + sin * ry
      const y = -sin * rx + cos * ry
      if (x < 0 || y < 0 || x > src.width || y > src.height) return false
    }
    return true
  }

  let t = 1
  if (!fits(1)) {
    let lo = 0
    let hi = 1
    for (let i = 0; i < 30; i++) {
      const midT = (lo + hi) / 2
      if (fits(midT)) lo = midT
      else hi = midT
    }
    t = lo
  }

  const boxW = Math.max(1e-6, (box.x1 - box.x0) * t)
  const boxH = Math.max(1e-6, (box.y1 - box.y0) * t)
  const x0 = cx - boxW / 2
  const y0 = cy - boxH / 2
  const scale = maxSide / Math.max(boxW, boxH)

  return {
    // 向下取整而非四舍五入：取上去会让画面比框还大一点点，
    // 边上那一行像素就没有内容 —— 正是要避免的那类空白
    width: Math.max(1, Math.floor(boxW * scale)),
    height: Math.max(1, Math.floor(boxH * scale)),
    a: scale * cos,
    b: scale * sin,
    c: -scale * sin,
    d: scale * cos,
    e: -x0 * scale,
    f: -y0 * scale,
  }
}

/** 21 点里取景只用到这两个 —— 与 landmarks.ts 的 HAND 同源，避免把整张表引进来 */
const HAND_VIEW_WRIST = 0
const HAND_VIEW_MIDDLE_MCP = 9

export function applyView(v: HandView, p: P2): P2 {
  return { x: v.a * p.x + v.c * p.y + v.e, y: v.b * p.x + v.d * p.y + v.f }
}

/** 把原照片坐标的标号搬到展示画面坐标；落到画面外的标号不落 */
export function marksToViewSpace(marks: PalmMark[], v: HandView): PalmMark[] {
  const inside = (p: P2): boolean => p.x >= 0 && p.x <= v.width && p.y >= 0 && p.y <= v.height
  return marks.map((m) => {
    const path = m.path?.map((p) => applyView(v, p))
    const anchor = m.anchor ? applyView(v, m.anchor) : null
    return {
      ...m,
      anchor: anchor && inside(anchor) ? anchor : null,
      ...(path ? { path } : {}),
    }
  })
}

/**
 * 「标准画布 → 展示画面」的点映射器，即上面两步的复合。
 *
 * 校正界面要用它：内部仍以标准画布坐标记录用户指认的线（度量层只认那个帧），
 * 但画出来、点上去都在扶正取景后的画面里。
 */
export function canvasToView(frame: SourceFrame, view: HandView): (p: P2) => P2 {
  const toSource = sourcePointMapper(frame)
  return (p: P2) => applyView(view, toSource(p))
}
