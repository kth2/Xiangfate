/**
 * 四类专用 User Prompt + 追问模板。与 docs/04-prompts.md 第三、四节同源。
 * 追问部分另注入 docs/xiangshu-qa-knowledge.md 的主题应对方向。
 */

import { buildOutline, type Outline } from '@/core/outline'
import { ANSWER_STRUCTURE, detectTopics, TOPIC_GUIDES, TYPE_QA_NOTES } from '@/core/qa'
import { explainScorecard } from '@/core/scorecard'
import { verdictBlock } from '@/core/verdicts'
import { BAND_LABEL } from '@/core/band'
import { SCORE_DIMENSIONS, type AnalysisEnvelope, type AnalysisType } from '@/core/types'

const HEAD: Record<AnalysisType, string> = {
  mianxiang: `【本次解读类型】面相

【数据来源说明】
以下特征由用户设备端的 MediaPipe Face Landmarker（478 个面部关键点）测量得出，
配合像素级的气色采样。全部计算在浏览器本地完成，照片未上传。
所有长度均以双眼外眼角距离（IOD）为基准归一化，因此与拍摄距离无关。

【解读重点】
请以传统面相学框架展开，依次关照：
  1. 三停（上停/中停/下停）——对应早年、中年、晚年的运势节奏
  2. 五官（眉、眼、鼻、口）——五岳与五官所主
  3. 十二宫——重点谈 derived.palaceHighlights 中的宫位，
     并温和提及 derived.palaceCautions 中的宫位
  4. 五形格局（金木水火土）——以 derived.fiveElements 为准，说明「以某形为主，兼某形」
  5. 气色——只关联作息与近期状态，严禁任何疾病指向

【特别提醒】
上停（发际线相关）的测量来自面部网格顶端，与真实发际线有偏差，
因此该项置信度天然偏低，措辞请相应缓和。

【关于 face3d.* 那批特征】
id 以 face3d. 开头的是**三维度量**（规范帧下的隆起、面积、对称残差等），
schema 2.0 新增。它们的用途是给既有论断提供数值依据，**不是新的断语**：
  · 可以用它们的数字把话说实（「山根相对面平面前突 4.2% IOD」）
  · **不要逐条罗列** —— 特征识别段仍只列几条关键的，其余融进正文
  · 它们的 meaning 字段写的是量纲说明而非相理，不要照抄进报告
  · 深度类一律为 inferred（弱透视 z 推出来的），措辞按推估处理`,

  shouxiang: `【本次解读类型】手相

【数据来源说明】
手型与指形来自 MediaPipe Hand Landmarker 的 21 个关节点测量；
掌线（掌纹）来自设备端的图像处理管线：先用关节点把手掌透视校正到标准掌面，
再经局部对比增强与方向滤波提取纹路，最后按位置先验归类到各主线。
全部在浏览器本地完成，照片未上传。

【解读重点】
  1. 手型（原始手/方形手/圆形手/锥形手/精神手）——先定基本气质
  2. 四大主线：生命线、智慧线、感情线、命运线；太阳线与婚姻线如有则简述
  3. 五指长短与指节
  4. 掌丘——重点谈 high 与 low 的丘
  5. 左右手对照——左手主先天禀赋，右手主后天努力（《神相全编》）

【关于掌线检测的重要说明】
derived.lineDetection 记录了每条主线的检测情况：
  · detected=false 的线：请按传统相法中「该线不显」的情形来谈，
    这在相学上本身就有其含义（例如命运线不显主不拘固定轨道），
    但**不要**假装它被测到了，也不要描述它的长短深浅。
  · corrected=true 的线：该线由用户手动校正确认，可正常解读，
    但请在「特征识别」中以「（经你本人确认）」标注一次。
  · handsCaptured 只有一只手时，不要对另一只手作任何推测，
    并在运势段说明「本次仅测一手，先天/后天对照暂缺」。`,

  guxiang: `【本次解读类型】骨相

【数据来源说明 —— 请务必先读】
骨相没有可直接测量骨骼的端侧模型。本次数据是**从体表轮廓推导**得来的：
  · 颧骨、额骨、鼻骨、下颌骨 —— 由面部关键点的宽度、角度、轮廓曲率推算
  · 骨肉关系 —— 由轮廓锐度、颏下厚度、面颊填充度综合推算
  · 肩骨、脊椎、骨盆 —— 若用户提供了体照，由 Pose 关键点推算
  · 头型 —— 需正面照 + 侧面照共同估算颅指数；缺侧面照时不可判定

因此这是一份「基于体表框架的骨相推估」，请在「特征识别」开头用一句话向用户说明这一点。

【解读重点】
  1. 骨相三原则：先头后体、骨肉并重、整体协调（《太清神鉴》）
  2. 可观测的骨：derived.observableBones —— 正常展开
  3. 间接推估的骨：derived.inferredBones —— 措辞必须弱化
  4. 头型与骨骼粗细（粗骨/中骨/细骨）
  5. 骨肉关系（骨多肉少/骨少肉多/骨肉相称）—— 这是本次最可靠的一项，可重点谈

【绝对边界】
derived.unobservableBones（通常包含枕骨、顶骨、耳后骨）以及龙骨、三台骨、反骨等
特殊骨相，**照片无法观测**。严禁对它们作任何论断、暗示或「一般而言」式的补充。
请在「特征识别」末尾如实说明：
「传统九骨中的〈列出名称〉需要实际触诊或多角度观察，本次照片无法获取，故不作论断。」`,

  tixiang: `【本次解读类型】体相

【数据来源说明】
数据来自 MediaPipe Pose Landmarker 的 33 个人体关键点。所有比例使用
worldLandmarks（米制、原点在髋中心）计算，因此与拍摄距离和镜头焦段无关。
全部在浏览器本地完成，照片未上传。

【解读重点】
  1. 体型（内胚/中胚/外胚/平衡/混合）——以 derived.somatotype 为准，
     说明是「以某型为主」而非绝对归类
  2. 身体比例——肩髋比、上下身比、颈长、臂长
  3. 体态——躯干倾角、肩线、重心、站姿开合；《冰鉴》重「形神兼备」，可引其意
  4. 肌肤气色——只关联作息与状态
  5. 自评项（若 derived.surveyAnswered 为 true）——声音、语速、衣着风格，
     必须以「据你自述」引出

【绝对边界】
  · 严禁对身高、体重作任何价值判断。即使用户自评填写了身高体重，
    也只能用于体型判断，**不得**出现「高个子格局大」「矮个子格局有限」
    「偏胖则……」这类论断。
  · 坐姿、走姿、睡姿无法从单张静态照片获取，不要提及。
  · 体态相关的提示（如圆肩、重心偏移）只能写成日常姿态建议，
    不得写成骨骼疾病或体态矫正医疗建议。`,
}

/**
 * 裁剪 envelope 以控制 token：raw.metrics 截断，policy 不必发（已写进 System）。
 *
 * ⚠️ 原注释写「只保留置信度最高的若干项」，实现却是 `Object.entries().slice()` ——
 * 按插入顺序截断，与置信度无关。raw.metrics 是一张扁平的数值表，
 * 本来也没有 confidence 可比。注释改成实话：这里就是按声明顺序取前 N 个，
 * 声明顺序已经把最常引用的量排在前面。
 */
export function trimEnvelope(env: AnalysisEnvelope): Record<string, unknown> {
  const { raw, policy: _policy, scorecard: _scorecard, ...rest } = env
  const trimmedRaw = raw?.metrics
    ? { normalizer: raw.normalizer, metrics: takeFirst(raw.metrics, 24) }
    : raw
  return { ...rest, ...(trimmedRaw ? { raw: trimmedRaw } : {}) }
}

function takeFirst(metrics: Record<string, unknown>, n: number): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metrics).slice(0, n))
}

/**
 * 把本地算出的五维星级连同「凭哪几条相理算出来的」一起写进 prompt。
 *
 * 星级由 core/scorecard 用固定权重算出，不经 AI —— 但之前它压根没进 prompt，
 * 模型看不到，报告里的论断因此可能和用户眼前的星级互相打架。
 * 现在把结论和依据一并给它，让它做「串起来讲」的事，而不是另起炉灶。
 */
function scorecardBlock(env: AnalysisEnvelope): string {
  const explain = explainScorecard(env.features)
  const lines = SCORE_DIMENSIONS.map((dim) => {
    const e = explain[dim]
    if (e.neutralFallback) {
      return `  · ${dim}：${e.stars} 星（该维特征不足，取中性值，请勿据此发挥）`
    }
    const drivers = e.drivers.length
      ? e.drivers
          .map(
            (d) =>
              `${d.label}（${d.direction === 'up' ? '推高' : d.direction === 'excess' ? '过盛反损' : '拉低'}）`,
          )
          .join('、')
      : '各项均在中和区间'
    return `  · ${dim}：${e.stars} 星 ← ${drivers}`
  })

  return `【本地已算出的五维星级 —— 由固定规则计算，不是你生成的】
${lines.join('\n')}

这份星级已经显示在用户眼前。你的任务是把它讲通：
  1. 论断必须与星级一致。不要说出与某一维星级明显矛盾的话
     （例如「执行意志」2 星却大谈其行动力过人）。
  2. 不要复述星级数字，也不要重新打分或换算成百分比 —— 那是规则的事。
  3. 上面「←」后面列的相理，是该维度得分的主要来由，
     展开时应优先落在这些条目上，让用户看得出星级从何而来。
  4. 标注「取中性值」的维度，说明本次没测到足够特征，不要就该维度作实质论断。`
}

/**
 * 「这个人最反常的几项」。
 *
 * 为什么必须单独给 —— features 数组是平铺的，每一项长得一样，
 * 于是模型只能按 JSON 顺序挨个写，写出来的自然人人相似。
 * 术士当面看相不是这样：先抓住这张脸上最扎眼的地方，再由它带出别的。
 * 这一段就是把「最扎眼的地方」算出来交给它。
 */
function salienceBlock(outline: Outline): string {
  const top = outline.salient.filter((f) => f.salience >= 0.3).slice(0, 6)
  if (!top.length) {
    return `【这个人最反常的几项】
无。本次各项都落在中和区间 —— 这本身就是这份报告要说的话：
平实无奇也是一种相。不要为了让报告显得丰富而把中和之处写成特点。`
  }
  // categorical 项没有「偏高/偏低」可言，别给它挂一个「—」的档位标记
  const lines = top.map((f) =>
    f.band === 'categorical'
      ? `  · ${f.label}：${f.evidence}`
      : `  · ${f.label}（${BAND_LABEL[f.band]}）：${f.evidence}`,
  )
  return `【这个人最反常的几项 —— 由偏离程度算出，不是你选的】
${lines.join('\n')}

这几项是本次报告的重心：
  1. 「特征识别」段开头就落它们，不要按数据里的顺序平铺。
  2. 后面各段展开时优先挂在这几项上 —— 中和区间里的项可以提，但不要当成特点讲。
  3. 若某一项传统视为忌处，照相书的意思讲，不因为它排在最前就缓和。`
}

/** 本次报告的段落提纲 —— 由 core/outline 按测到的东西算出 */
function outlineBlock(outline: Outline): string {
  const briefs = outline.topics.map((t) => `  · ## ${t.title} —— ${t.brief}`)
  return `【本次报告提纲 —— 按这个人测到的东西算出，照它写】
${outline.sections.map((sec) => `  ## ${sec}`).join('\n')}

其中专题段的写作要点：
${briefs.length ? briefs.join('\n') : '  （本次未入选专题段）'}

注意：这份提纲**因人而异**。别人的报告可能有「财帛与积累」而这一份没有，
那是因为这个人在财帛相关的项上没测出名堂 —— 不要因此自己补一段回来。`
}

export function buildUserPrompt(env: AnalysisEnvelope): string {
  const topics = env.subject?.focusTopics?.filter(Boolean) ?? []
  const outline = buildOutline(env.features, topics)

  // 关注方向放在最前面：它要影响的是「写哪几段、重心落在哪」，
  // 放在末尾等于让它去和整套格式要求抢注意力，抢不过。
  const focus = topics.length
    ? `【用户关注方向 —— 已计入下面的提纲】
${topics.join('、')}
这几个方向对应的专题段（若有测到的特征支撑）已经进了提纲，展开时向它们倾斜。
但**不得**为了迎合关注方向而编造特征：数据里没有的，就照实说这次没覆盖。`
    : `【用户关注方向】
未指定 —— 按提纲给定的重心展开即可，不要平均用力。`

  return `${HEAD[env.analysisType]}

${focus}

${outlineBlock(outline)}

${salienceBlock(outline)}

【结构化特征数据】
${JSON.stringify(trimEnvelope(env), null, 1)}

${verdictBlock(env.features, env.analysisType)}

${scorecardBlock(env)}

请按上面【本次报告提纲】给定的标题与顺序输出，不增不减。`
}

export interface FollowUpOptions {
  /** 用于注入该相术专属的应答提醒 */
  type: AnalysisType
  /** 命中重大人生决定关键词（由 core/guard.preflightQuestion 判定） */
  majorDecision?: boolean
}

/**
 * 追问 Prompt。
 *
 * 除固定要求外，会按问题主题注入知识库里的「术士应对方向」与「本项目口径」——
 * 只注入命中的那几条，问什么给什么，避免把整本知识库塞进每一轮上下文。
 */
export function buildFollowUpPrompt(question: string, turn: number, opts: FollowUpOptions): string {
  return `【追问轮次】第 ${turn} 轮

用户的问题：${question}
${topicBlock(question)}
【回答结构】按这个顺序组织，不要写小标题，自然成段：
${ANSWER_STRUCTURE.map((s, i) => `${i + 1}. ${s}`).join('\n')}

【本类相术的应答提醒】
${TYPE_QA_NOTES[opts.type].map((n) => `· ${n}`).join('\n')}
${opts.majorDecision ? MAJOR_DECISION_NOTE : ''}
回答要求：
1. 仍然只能基于上面那份特征数据立论。若问题涉及的特征不在数据中，
   或位于 unavailable 列表，请直接说明「这一点本次测量没有覆盖」，
   并说明需要什么条件才能测到（例如「需要补一张侧面照」）。
2. 不要重复输出报告的分段结构。直接针对问题作答。
3. 长度 200–500 字，用自然段，最多用一个小列表。
4. System 中的所有禁止事项继续有效，尤其是：
   不预测具体事件与时间、不作疾病诊断、不作寿夭判断。
   但传统相书里不好听的断语不在此列 —— 测到什么就照传统的意思讲什么。
5. 若用户追问的是「我到底能不能……」「会不会……」这类求确定答案的问题，
   照传统相法怎么看这类特征来答，并说明可以怎么做；
   不必给是/否的保证，也不必因为答案不好听就绕开。`
}

/**
 * 命中主题时注入的方向提示。
 * approach 是传统术士的答法，boundary 是本项目盖过传统做法的地方 —— 两者必须成对出现，
 * 只给 approach 等于放模型去按旧规矩答。
 */
function topicBlock(question: string): string {
  const topics = detectTopics(question).slice(0, 3)
  if (!topics.length) return '\n'

  const lines = topics.map((t) => {
    const g = TOPIC_GUIDES[t]
    return `· ${g.label}：${g.approach}${g.boundary ? `\n  本项目口径：${g.boundary}` : ''}`
  })
  return `
【这个问题的传统应对方向】
${lines.join('\n')}
`
}

const MAJOR_DECISION_NOTE = `
【注意】这个问题牵涉重大人生决定。先用一句话说明这类事不该靠相术来定，
再就其中「你自己是怎样的人、怎么用力更顺」的部分作答，不要给出该不该做的建议。
`

/** 从第 4 轮起用本地摘要替换首份报告全文，控制上下文长度 */
export function summarizeReport(report: string, maxChars = 200): string {
  const sections = report.split(/(?=^##\s)/m).filter((s) => s.trim())
  const picked = sections
    .map((s) => {
      const nl = s.indexOf('\n')
      const title = s.slice(3, nl > 0 ? nl : undefined).trim()
      const body = (nl > 0 ? s.slice(nl) : '').replace(/[-*·#\s]+/g, ' ').trim()
      return `${title}：${body.slice(0, 40)}`
    })
    .join('；')
  return picked.length > maxChars ? `${picked.slice(0, maxChars)}…` : picked
}
