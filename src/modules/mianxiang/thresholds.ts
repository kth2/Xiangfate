/**
 * 面相所有阈值集中于此。
 *
 * ── 校准来源（重要）──────────────────────────────────────
 * 初稿的阈值是按传统相术的**理想值**猜的（「五眼」就取 5.0、「三停均分」就取 1/3），
 * 结果被 __tests__/pipeline.test.ts 打脸：把 MediaPipe 官方的规范人脸网格
 * （canonical_face_model，一张标准化的参考脸）投影到图像坐标后实测，
 * 多数指标与理想值相差甚远。例如：
 *     鼻翼宽实测 0.40×IOD，初稿却写 0.58–0.72
 *     人中长实测 0.15×IOD，初稿却写 0.28–0.40
 *     眼距实测 1.43 个眼宽，初稿却写 0.9–1.15
 * 按初稿的阈值，几乎每个人都会被判成「鼻翼窄、人中短、眼距开阔」—— 系统性偏差。
 *
 * 现在改为：**以规范脸的实测值为「中和」的中心**，两侧按变异度给带宽。
 * 每个常量后面的注释就是规范脸的实测值。
 *
 * ⚠️ 仍需说明：规范脸是一张参考脸，不是人群分布。带宽（±8% / ±15%）
 * 仍是工程判断。真正的标定需要真实样本回归 —— 标了 CALIBRATE 的就是这些。
 * ────────────────────────────────────────────────────────
 */

import type { BandSpec } from '@/core/band'

/** 围绕中心值造一个五档区间：balanced = center×[1-a, 1+a]，极端档 = ×[1-b, 1+b] */
function around(center: number, a: number, b: number): BandSpec {
  return {
    veryLo: center * (1 - b),
    lo: center * (1 - a),
    hi: center * (1 + a),
    veryHi: center * (1 + b),
  }
}

/**
 * 发际线修正系数。
 *
 * landmark 10 是面部网格的顶端，**不是发际线** —— 规范脸上它算出的上停只占 18.4%，
 * 而中停 40.2%、下停 41.4%（中下几乎等长，符合传统 1:1）。
 * 若把规范脸视为「三停均衡」的基准，则上停需要放大 (0.402+0.414)/2 / 0.184 ≈ 2.22 倍。
 *
 * 这是一个**外推**，不是测量：真实发际线因人而异（额头高、发际后移者尤甚）。
 * 因此上停的 methodPrior 只给 0.65，且 evidence 里会注明「经发际线修正」。
 * 想要真值需要加载 ImageSegmenter 取头发/皮肤边界 —— 那是后续增强项。
 */
export const HAIRLINE_FACTOR = 2.22

export const T = {
  /** 三停：修正后单停占比，理想各 1/3 */
  court: { veryLo: 0.26, lo: 0.30, hi: 0.37, veryHi: 0.41 } satisfies BandSpec,
  /** 三停「平均」的判定：两两最大差值 ≤ 此值。CALIBRATE */
  courtBalanceTol: 0.05,

  /** 五眼：脸宽 ÷ 单眼宽。规范脸 5.98（传统理想 5.0，实际人脸更宽） */
  fiveEye: around(5.98, 0.08, 0.15),
  /** 两眼间距 ÷ 单眼宽。规范脸 1.43（传统理想 1.0） */
  innerGap: around(1.43, 0.08, 0.16),

  /** 眉长（眉头→眉尾直线）÷ 同侧眼长。规范脸 1.74 */
  browLen: around(1.74, 0.07, 0.15),
  /** 「眉长过目」的判线：明显超过规范脸 */
  browOverEye: 1.86,
  /** 眉弯曲度（矢高÷弦长）。CALIBRATE —— 规范脸的眉下缘偏平 */
  browCurve: { veryLo: 0.04, lo: 0.06, hi: 0.14, veryHi: 0.2 } satisfies BandSpec,
  browStraight: 0.06,
  browCrescentLo: 0.1,
  browCrescentHi: 0.2,
  /** 眉毛浓密度（眉区暗像素占比）。像素类指标，规范脸无参照，CALIBRATE */
  browDensity: { veryLo: 0.22, lo: 0.3, hi: 0.55, veryHi: 0.7 } satisfies BandSpec,
  /** 印堂宽 ÷ 单眼宽。规范脸 0.53 */
  browGap: around(0.53, 0.12, 0.24),
  browGapNarrow: 0.44,

  /** 眼纵横比 = 眼高 ÷ 眼长。规范脸 0.259 */
  eyeAspect: around(0.259, 0.1, 0.22),
  eyeRound: 0.32,
  eyeNarrow: 0.23,
  /** 外眦上扬角（度）。规范脸 1.74°。角度是绝对量，不按比例缩放 */
  canthalTilt: { veryLo: -4, lo: -1, hi: 5, veryHi: 8 } satisfies BandSpec,
  canthalUp: 4,
  canthalDown: -1.5,
  /** 巩膜暴露（三白眼判定）。CALIBRATE */
  scleraShow: 0.12,

  /** 鼻长 ÷ IOD。规范脸 0.603 */
  noseLen: around(0.603, 0.08, 0.16),
  /** 鼻翼宽 ÷ IOD。规范脸 0.402 */
  alarWidth: around(0.402, 0.08, 0.16),
  alarFull: 0.434,
  /** 鼻梁偏移 ÷ IOD。规范脸 ≈0（中轴上），此项是「越小越直」，不用 around */
  bridgeDeviation: { veryLo: 0.004, lo: 0.01, hi: 0.025, veryHi: 0.045 } satisfies BandSpec,
  bridgeStraight: 0.025,
  /** 山根深度突出，已在 metrics 中归一化到 0–1。CALIBRATE */
  bridgeHeight: { veryLo: 0.25, lo: 0.38, hi: 0.65, veryHi: 0.8 } satisfies BandSpec,
  /** 准头饱满度 0–1。CALIBRATE */
  tipFullness: { veryLo: 0.28, lo: 0.4, hi: 0.68, veryHi: 0.82 } satisfies BandSpec,
  /** 鼻孔暴露占比。CALIBRATE */
  nostrilShow: { veryLo: 0.04, lo: 0.08, hi: 0.16, veryHi: 0.22 } satisfies BandSpec,
  nostrilHidden: 0.1,
  nostrilExposed: 0.22,
  /** 鼻翼宽 ÷ 鼻长。规范脸 0.667 */
  noseAspect: around(0.667, 0.1, 0.2),

  /** 口宽 ÷ 鼻翼宽。规范脸 1.375 */
  mouthAlar: around(1.375, 0.07, 0.14),
  mouthWide: 1.47,
  mouthNarrow: 1.28,
  /** 上下唇合计厚度 ÷ IOD。规范脸 0.159 */
  lipThickness: around(0.159, 0.12, 0.25),
  lipThick: 0.178,
  lipThin: 0.14,
  /** 口角上扬量 ÷ 口宽。规范脸接近 0（中性表情），保持绝对阈值 */
  cornerLift: { veryLo: -0.05, lo: -0.02, hi: 0.03, veryHi: 0.06 } satisfies BandSpec,
  cornerUp: 0.03,
  cornerDown: -0.03,
  /** 人中长 ÷ IOD。规范脸 0.148 */
  philtrumLen: around(0.148, 0.1, 0.22),
  philtrumLong: 0.163,
  philtrumShort: 0.133,

  /** 对称性 */
  symmetryTol: 0.08,
  symmetryGood: 0.85,

  /** 十二宫饱满度（明暗+z 推导，0–1）。CALIBRATE */
  palaceFullness: { veryLo: 0.25, lo: 0.38, hi: 0.65, veryHi: 0.8 } satisfies BandSpec,
  /** 田宅宫：眉眼间距 ÷ 单眼宽。规范脸 0.498 */
  tianzhai: around(0.498, 0.12, 0.25),

  /** 气色。像素类指标，CALIBRATE */
  complexion: {
    ruddy: 0.5,
    pale: -0.8,
    yellow: 0.8,
    uneven: 0.7,
    uniformGood: 0.85,
    brightL: 62,
    darkL: 42,
  },

  /**
   * 五形分类判据。规范脸：面宽高比 0.877、颌颧比 0.775、额颧比 0.670。
   * 判线按规范脸左右偏移设置，避免所有人都落进同一形。
   */
  fiveElements: {
    wideFW: 0.92, // 明显宽于规范脸
    narrowFW: 0.83, // 明显窄于规范脸
    squareJC: 0.82,
    fullJC: 0.86,
    narrowJC: 0.73,
    wideFC: 0.72,
    /** 下颌轮廓曲率半径 ÷ IOD。CALIBRATE */
    sharpCR: 0.35,
    roundCR: 0.55,
    minScore: 0.55,
  },
} as const
