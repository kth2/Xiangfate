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
export function marksToSourceSpace(marks: PalmMark[], frame: SourceFrame): PalmMark[] {
  const Hinv = invertHomography(frame.H)

  const back = (p: P2): P2 => {
    const q = applyHomography(Hinv, p)
    // 撤掉左手那一次水平镜像，再按展示尺寸缩放
    const x = frame.mirrored ? frame.srcWidth - 1 - q.x : q.x
    return { x: x * frame.scale, y: q.y * frame.scale }
  }

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
