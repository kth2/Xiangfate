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
 * ⚠️ 仍需说明：规范脸是一张参考脸，不是人群分布（N=1）。带宽（±8% / ±15%）
 * 仍是工程判断，且所有指标统一用同一套百分比 —— 各指标真实离散度差异很大，
 * 这至少对其中一部分是错的。标了 CALIBRATE 的就是这些。
 *
 * 带宽相对真实离散度的大小，决定了**有多少比例的用户会拿到断语**：
 * 带宽偏窄则人人都有一堆忌相，偏宽则人人都是平淡报告。现在无法区分
 * 「这张脸确实中和」与「带宽定得太宽」—— 因为没有分布可比。
 *
 * 已做的缓解：贴线项降置信度（core/band.ts）、连拍取中位数（core/frames.ts）、
 * 像素类指标改对同脸对照区取比值、robustness.test.ts 的位姿扰动检查。
 * 仍要做的：离线跑公开数据集/人体测量学文献定分位。详见 docs/02 第 0.5 节。
 * ────────────────────────────────────────────────────────
 */

import type { BandSpec } from '@/core/band'

/**
 * ── 带宽收窄（2026-08）─────────────────────────────────────
 * 差异化审计（src/dev/__tests__/differentiation.test.ts）量了一件事：
 * 归一化到 0–1 的明暗/深度类指标，中和区半宽普遍在 ±26%–±40%，
 * 也就是中和档一口吃掉了这些指标**自己输出范围的一半以上**。
 * 后果是两端四档形同装饰：这些特征照样占报告篇幅、照样占星级权重，
 * 却对每个人给同一个判断。
 *
 * 于是把这一类统一收到 ±15%。这**不是校准** —— 没有人群分布可依，
 * ±15% 仍是工程判断，只是比 ±30% 少错一些：至少两端档位变得可达。
 * 标了 CALIBRATE 的项目仍然待校准，收窄不代表定案。
 *
 * 比例类（长度之比）不动：它们本来就在 ±7%–±12%，与人体测量学文献里
 * 4%–7% 的离散度同一量级。
 *
 * 中心在 0 附近的带符号量（cornerLift、canthalTilt）也不动：
 * 「半宽 ÷ 中心」对它们没有意义，实测两张脸分别落 very_high / balanced，
 * 本来就能区分人。审计里那两个夸张的百分比是除以近零中心的假象。
 * ────────────────────────────────────────────────────────
 */

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
  /**
   * 三停「平均」的判定：两两最大差值 ≤ 此值。
   *
   * 原值 0.05 下有 78% 的人判「三停平均」并拿到贵格断语 —— 传统里三停匀停
   * 本该是一件值得一提的事，不该是默认值。实测 maxDiff：规范脸 0.010、
   * 真人脸夹具 0.025，收到 0.03 让「三停平均」回到少数，
   * 同时让「天庭饱满/中停丰隆/地阁方圆」这一支真正有机会出现。CALIBRATE
   */
  courtBalanceTol: 0.03,

  /** 五眼：脸宽 ÷ 单眼宽。规范脸 5.98（传统理想 5.0，实际人脸更宽） */
  fiveEye: around(5.98, 0.08, 0.15),
  /** 两眼间距 ÷ 单眼宽。规范脸 1.43（传统理想 1.0） */
  innerGap: around(1.43, 0.08, 0.16),

  /** 眉长（眉头→眉尾直线）÷ 同侧眼长。规范脸 1.74 */
  browLen: around(1.74, 0.07, 0.15),
  /** 「眉长过目」的判线：明显超过规范脸 */
  browOverEye: 1.86,
  /** 眉弯曲度（矢高÷弦长）。实测 0.124/0.148，收窄至约 ±15%。CALIBRATE */
  browCurve: { veryLo: 0.09, lo: 0.115, hi: 0.155, veryHi: 0.185 } satisfies BandSpec,
  browStraight: 0.06,
  browCrescentLo: 0.1,
  browCrescentHi: 0.2,
  /** 眉毛浓密度（眉区暗像素占比）。像素类指标，规范脸无参照，收窄至 ±15%。CALIBRATE */
  browDensity: { veryLo: 0.28, lo: 0.36, hi: 0.49, veryHi: 0.6 } satisfies BandSpec,
  /**
   * 印堂宽 ÷ 单眼宽。
   *
   * ⚠️ 原值写的是 `around(0.53, ...)`，注释也标「规范脸 0.53」—— 这个数是错的。
   * metrics 里算的是**两眉头之间的整段距离**（BROW.inner 285 ↔ 55），
   * 规范脸实测 0.943、真人脸夹具实测 0.983；0.53 更接近单侧到中线的半距（0.47）。
   * 于是判线整体偏低约 1.8 倍，后果不是「偏一点」而是：
   *     每一个人都落在 very_high → 一律「印堂开阔」，
   *     「印堂宽广」（贵格）与「印堂偏窄」（忌相）两条断语都永不命中，
   *     且 very_high 在星级里按「过盛反损」计负（core/band.ts 的 BAND_DELTA），
   *     于是每个人的「才智思辨」「气度格局」都被同一条错判压低。
   * 见 src/dev/__tests__/differentiation.test.ts。
   *
   * 现按本文件既定方法（以规范脸实测值为中和中心）重设中心，带宽不变。
   */
  browGap: around(0.943, 0.08, 0.18),
  /** 「印堂偏窄」的硬判线，沿用原来相对中心的位置（0.44/0.53 ≈ 0.83） */
  browGapNarrow: 0.78,

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

  /**
   * 虹膜可见度 = 可见虹膜高 ÷ 虹膜直径（「眼神清明 / 含蓄」的判据）。
   *
   * 原判线写在 rules 里：lo=0.62、hi=0.85。那是照传统「目宜露神」的语感定的，
   * 不是照测量定的 —— 人的睑裂高普遍**小于**虹膜直径（虹膜约 11.7mm、
   * 睑裂高约 9–11mm），于是这个比值天然压在 0.6 上下：
   * 规范脸实测 0.588、真人脸夹具 0.587，两张都在中和档下沿之外。
   * 后果是凡是测过的人都判「眼神含蓄」，都拿到忌相「目光藏 —— 城府较深」，
   * 而贵格「目光清明」（需 ≥0.85）在解剖上几乎不可能达到。
   *
   * 现按实测值重设中心并收窄。⚠️ N=2，仍是待校准项：
   * 这一改只是把「人人城府深」换成一个能区分人的分布，不等于定案。
   */
  openness: around(0.588, 0.08, 0.18),

  /** 鼻长 ÷ IOD。规范脸 0.603 */
  noseLen: around(0.603, 0.08, 0.16),
  /** 鼻翼宽 ÷ IOD。规范脸 0.402 */
  alarWidth: around(0.402, 0.08, 0.16),
  alarFull: 0.434,
  /** 鼻梁偏移 ÷ IOD。规范脸 ≈0（中轴上），此项是「越小越直」，不用 around */
  /**
   * ⚠️ 已不再用于判断。该项列入 core/evidenceOnly（判线离实测量级 11–52 倍），
   * 规则层只报数值。区间保留，供 differentiation 审计对照与将来重设参考。
   */
  bridgeDeviation: { veryLo: 0.004, lo: 0.01, hi: 0.025, veryHi: 0.045 } satisfies BandSpec,
  /** 山根深度突出，已在 metrics 中归一化到 0–1。实测 0.47/0.57，收窄至 ±15%。CALIBRATE */
  bridgeHeight: { veryLo: 0.36, lo: 0.44, hi: 0.60, veryHi: 0.68 } satisfies BandSpec,
  /** 准头饱满度 0–1。实测 0.41/0.61，收窄至 ±15%。CALIBRATE */
  tipFullness: { veryLo: 0.39, lo: 0.46, hi: 0.62, veryHi: 0.71 } satisfies BandSpec,
  /** 鼻孔暴露占比。收窄至 ±15%。CALIBRATE */
  nostrilShow: { veryLo: 0.075, lo: 0.095, hi: 0.13, veryHi: 0.16 } satisfies BandSpec,
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

  /** 十二宫饱满度（明暗+z 推导，0–1）。收窄至 ±15%。CALIBRATE */
  palaceFullness: { veryLo: 0.36, lo: 0.44, hi: 0.60, veryHi: 0.68 } satisfies BandSpec,
  /** 田宅宫：眉眼间距 ÷ 单眼宽。规范脸 0.498 */
  tianzhai: around(0.498, 0.12, 0.25),

  /**
   * 卧蚕 / 泪堂（男女宫）。明暗起伏推断，受光照方向影响大，CALIBRATE
   * ridge：亮脊与其下暗沟的落差；hollow：眼下带比颊部暗多少
   */
  woCanRidge: { veryLo: 0.095, lo: 0.11, hi: 0.15, veryHi: 0.18 } satisfies BandSpec,
  woCanFull: 0.17,
  tearTroughHollow: 0.14,
  /** 相对同脸平颊起伏的倍数。有基线时以它为准 —— 绝对值里混着光照方向 */
  woCanRidgeRatio: 1.8,

  /**
   * 法令纹。depth 是沿线局部暗度的中位数，continuity 是测得到纹沟的采样点占比。
   * 两者都过线才算「法令深长」—— 只深不连多半是鼻侧阴影，CALIBRATE
   */
  nasolabial: { veryLo: 0.075, lo: 0.085, hi: 0.115, veryHi: 0.14 } satisfies BandSpec,
  nasolabialDeep: 0.13,
  nasolabialFaint: 0.07,
  nasolabialContinuity: 0.5,
  /** 相对同脸平颊纹理的倍数。有基线时以它为准，绝对深度退为兜底 */
  nasolabialDeepRatio: 2.2,
  nasolabialFaintRatio: 1.3,

  /** 痣：相对周围肤色的暗度落差，低于此值不认为是痣。CALIBRATE */
  moleContrast: 0.16,
  /**
   * 「显痣」的判线：又大又深的才算，记 very_low；其余记 low。
   *
   * 传统相术里痣论轻重看的是「显」与「隐」—— 隐痣不作重断。
   * 两条都过线才算显，只深不大多半是痘印或色斑残留。CALIBRATE
   */
  moleProminentContrast: 0.26,
  /** 直径 ÷ IOD。约合成年人脸上 1.5mm 以上的痣 */
  moleProminentSize: 0.025,

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
