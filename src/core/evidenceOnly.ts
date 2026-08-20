/**
 * 「只作数值依据、不下判断」的特征名单。
 *
 * 为什么需要这一层 ——
 * 一条特征要能下判断，前提是它的**判线站得住**。判线站不住的时候有两种错法：
 * 判线太低 → 人人都拿到贵格；判线太高 → 人人都拿到忌相。两种都不是「偏一点」，
 * 而是这条特征彻底不携带关于这个人的信息，却照样占着报告篇幅、占着星级权重、
 * 还照样给每个人发一条断语。
 *
 * 原来只有 3D 特征走这条路（verdicts.ts 里的 isMeasurementOnly 按 id 前缀判断）。
 * 那个机制是对的，只是范围太窄：二维里也有判线明显站不住的项。
 * 现在把名单提到 core，二维三维同一个入口，加一条就是一行。
 *
 * 列进来的项**仍然进报告**：数值、证据照给，AI 可以引用它把话说实。
 * 它不做的只有三件事：不出传统术语的吉凶断语、不进五维星级、不作立论依据。
 *
 * ⚠️ 本文件属于 src/core，只放纯数据与纯函数。
 */

/**
 * 逐条理由。每一条都要写清「凭什么说这条判线站不住」——
 * 没有理由的项不许进这张表，否则这里会变成掩盖问题的垃圾桶。
 */
export const EVIDENCE_ONLY: Record<string, string> = {
  /**
   * 三维度量整体未校准。原有 isMeasurementOnly 的语义，原样保留。
   * 曾经出过事：face3d.nose.rootDepth 的 label 是「山根隆起」，与断语表撞名，
   * 于是每张脸都无条件拿到一条贵格断语，而该项实测值可能是负的。
   */
  'face3d.': '三维项的阈值尚未用真实人群校准，只能作数值依据',

  /**
   * 鼻梁偏移：判线离实测量级 11–52 倍，全部不可达。
   *
   * metrics 里算的是鼻梁各点相对「山根→鼻底」弦线的最大矢高（弓度），
   * 规范脸实测 0.000、真人脸夹具 0.0008，而「挺直」的判线写 0.025 ——
   * 是实测值的 30 倍。于是 98% 的人判「鼻梁挺直」并拿到贵格断语「梁柱端正」，
   * 那条断语因此等于报告模板的一部分。
   *
   * 光靠两张直鼻子定不出「歪鼻子」的线，所以不是重设判线的问题：
   * 在有歪鼻样本之前，这一项只报数、不判吉凶。
   * 见 src/dev/__tests__/differentiation.test.ts。
   */
  'face.nose.bridge': '判线离实测量级 11–52 倍，全部不可达；需要真实的偏曲鼻样本才能定线',
}

/** 该特征是否只作数值依据。前缀以 `.` 结尾的按前缀匹配，其余按整个 id 匹配。 */
export function isEvidenceOnly(id: string): boolean {
  for (const key of Object.keys(EVIDENCE_ONLY)) {
    if (key.endsWith('.') ? id.startsWith(key) : id === key) return true
  }
  return false
}

/** 命中的理由，供 dev 页面与测试报告显示 */
export function evidenceOnlyReason(id: string): string | null {
  for (const [key, reason] of Object.entries(EVIDENCE_ONLY)) {
    if (key.endsWith('.') ? id.startsWith(key) : id === key) return reason
  }
  return null
}
