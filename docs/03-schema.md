# 03 · 结构化特征 JSON Schema

> 这是**端侧特征提取**与 **AI 解读**之间唯一的契约。原图永不离开设备，只有本文档定义的 JSON 会被发送。
> 机器可读版本见 `schemas/` 目录（JSON Schema Draft 2020-12）。

---

## 一、设计原则

1. **统一信封（envelope），差异化载荷（payload）** —— 四种相术共用外层结构，`features` 数组是统一格式，`raw` 里放各自的原始度量。
2. **每条特征自带证据与置信度** —— AI 不需要（也不允许）猜测某条特征是否可信。
3. **`unavailable` 是一等公民** —— 测不到的东西必须显式出现在 JSON 里并标明原因，而不是静默省略。静默省略会让 AI 以为「没提到 = 可以自由发挥」。
4. **体积可控** —— 目标单次请求 ≤ 8 KB / ≈ 2000 token。**不发送任何 landmark 原始坐标**（478×3 个浮点数既无意义又浪费 token，且理论上可反推面部几何）。
5. **版本化** —— `schemaVersion` 变更时 Prompt 模板同步升级。

---

## 二、统一信封

```jsonc
{
  "schemaVersion": "1.0.0",
  "analysisType": "mianxiang",        // mianxiang | shouxiang | guxiang | tixiang
  "analysisId": "a7f3...",            // 本地生成的 UUID，用于历史记录关联
  "capturedAt": "2026-08-01T10:22:00+08:00",
  "locale": "zh-CN",

  "subject": {                        // 全部可选，用户自愿填写
    "ageBand": "26-35",               // 18-25 | 26-35 | 36-45 | 46-55 | 56+ | null
    "gender": "unspecified",          // male | female | unspecified  ← 仅用于称谓，不用于差异化断言
    "isSelf": true,                   // 是否本人照片（合规确认）
    "focusTopics": ["事业", "人际"]    // 用户关心的方向，最多 3 项
  },

  "capture": {
    "shots": ["front"],               // front | profile | left_palm | right_palm | full_body
    "quality": {
      "score": 0.86,                  // 0–1 综合质量分
      "resolution": "ok",             // ok | low
      "lighting": "ok",               // ok | dim | harsh | color_cast
      "sharpness": "ok",              // ok | blurry
      "pose": { "yaw": -3.2, "pitch": 4.1, "roll": 1.0 },   // 面相/骨相；单位：度
      "occlusion": [],                // ["hair_covers_forehead", "glasses", "mask", ...]
      "issues": []                    // 人类可读的问题短语，供 UI 提示
    }
  },

  "features": [ /* FeatureItem[]，见第三节 */ ],

  "derived": { /* 各类型专属的综合判定，见第五节 */ },

  "raw": { /* 原始数值度量，见第六节。可通过设置裁剪掉以省 token */ },

  "unavailable": [ /* UnavailableItem[]，见第四节 */ ],

  "scorecard": {                      // 本地算出，不由 AI 生成
    "气度格局": 4, "才智思辨": 4, "人际情感": 3, "执行意志": 5, "根基福泽": 3
  },

  "policy": {
    "disclaimerRequired": true,
    "forbidTopics": ["寿命", "疾病诊断", "具体事件时间", "婚姻成败", "生育", "政治"]
  }
}
```

---

## 三、FeatureItem（核心）

```jsonc
{
  "id": "face.threeCourts.balance",         // 稳定的点分路径 ID
  "category": "三停",                        // 中文分组，用于报告分节
  "label": "三停平均",                       // 传统术语，直接可写进报告
  "band": "balanced",                        // very_low|low|balanced|high|very_high|categorical
  "value": "1.02 : 0.99 : 0.99",             // 人类可读的测量结果（字符串或数字）
  "status": "measured",                      // measured|inferred|self_reported|unavailable
  "confidence": 0.88,                        // 0–1
  "evidence": "上停 34.1%，中停 33.1%，下停 32.8%，两两差 ≤ 1.3%",
  "meaning": "一生运势平稳，各阶段无显著起落",  // 来自规则表的释义要点（已过内容策略）
  "source": "麻衣神相"                        // 经典出处，可为 null
}
```

### 字段约束

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 正则 `^[a-z]+(\.[a-zA-Z0-9_]+)+$`，全局唯一且稳定 |
| `category` | string | ✅ | 见下方分组表 |
| `label` | string | ✅ | 传统术语；AI 应优先使用此词 |
| `band` | enum | ✅ | 含 `categorical`（型态类特征，如「新月眉」无高低之分） |
| `value` | string \| number | ✅ | |
| `status` | enum | ✅ | |
| `confidence` | number | ✅ | `[0,1]` |
| `evidence` | string | ✅ | **必须包含具体数值**，供 AI 引用与用户核对 |
| `meaning` | string | ✅ | 已经过 `07-content-policy.md` 过滤 |
| `source` | string \| null | ✅ | |

### category 分组表

| 类型 | 可用 category |
|---|---|
| 面相 | `三停` `五眼` `眉` `眼` `鼻` `口` `耳` `十二宫` `气色` `五形` `脸型` `对称` |
| 手相 | `手型` `指形` `掌线` `掌丘` `掌色` `左右手` |
| 骨相 | `头型` `九骨` `骨肉` `骨骼粗细` `体骨` `特殊骨相` |
| 体相 | `体型` `身体比例` `体态` `肌肤气色` `自评` |

---

## 四、UnavailableItem

**这是本 Schema 最重要的设计**。测不到的项必须显式声明，AI 才知道边界在哪。

```jsonc
{
  "id": "bone.nineBones.occipital",
  "label": "枕骨",
  "reason": "not_observable",
  "detail": "枕骨位于后脑，正面与侧面照片均无法观测，且常被头发遮挡"
}
```

`reason` 枚举：

| 值 | 含义 | 典型例子 |
|---|---|---|
| `not_observable` | 该部位在任何照片中都不可见 | 枕骨、顶骨、耳后骨 |
| `not_captured` | 用户未提供所需照片 | 未拍侧面照 → 头型 |
| `low_confidence` | 检测到了但置信度低于 0.35 | 掌纹归类失败、气色严重色偏 |
| `out_of_scope` | 照片本质无法承载 | 干湿手、软硬手、声音、睡姿 |
| `policy_excluded` | 内容策略主动排除 | 女性忌相、寿命相关判定 |

> `policy_excluded` 项**不发送给 AI**（避免提示 AI 存在这些话题），仅记录在本地日志供审计。发送给 AI 的只有前四种。

---

## 五、derived（各类型专属综合判定）

### 面相
```jsonc
"derived": {
  "fiveElements": { "primary": "土", "primaryScore": 0.62, "secondary": "金", "secondaryScore": 0.41 },
  "faceShape": "国字脸",
  "courtDominance": "balanced",        // upper | middle | lower | balanced
  "symmetryScore": 0.91,
  "palaceHighlights": ["财帛宫", "官禄宫"],   // 得分最高的 2–3 宫
  "palaceCautions": ["迁移宫"]                // 得分最低的 1–2 宫
}
```

### 手相
```jsonc
"derived": {
  "handType": { "primary": "方形手", "score": 0.71, "secondary": "原始手", "secondaryScore": 0.44 },
  "dominantHand": "right",
  "handsCaptured": ["left", "right"],
  "lineDetection": {
    "生命线": { "detected": true,  "matchScore": 0.82, "corrected": false },
    "智慧线": { "detected": true,  "matchScore": 0.77, "corrected": false },
    "感情线": { "detected": true,  "matchScore": 0.69, "corrected": true  },
    "命运线": { "detected": false, "matchScore": 0.31, "corrected": false },
    "太阳线": { "detected": false, "matchScore": 0.18, "corrected": false }
  },
  "leftRightComparison": "右优于左",
  "mountProfile": { "木星丘": "high", "土星丘": "balanced", "太阳丘": "low",
                    "水星丘": "high", "金星丘": "balanced", "月丘": "low", "火星丘": "balanced" }
}
```

### 骨相
```jsonc
"derived": {
  "headShape": { "value": "方头型", "cephalicIndex": 0.79, "status": "inferred" },
  "boneFleshRatio": 0.52,
  "boneFleshLabel": "骨肉相称",
  "boneThickness": "中骨型",
  "observableBones": ["颧骨", "额骨", "鼻骨", "下颌骨"],
  "inferredBones": ["颞骨", "眉骨"],
  "unobservableBones": ["枕骨", "顶骨", "耳后骨"],
  "specialForms": []                    // 仅当可测且成立时填入，如 ["虎骨"]
}
```

### 体相
```jsonc
"derived": {
  "somatotype": { "primary": "中胚型", "scores": { "内胚": 0.28, "中胚": 0.61, "外胚": 0.35 } },
  "proportion": { "upperLowerRatio": 0.86, "shoulderHipRatio": 1.42, "label": "下半身略长，比例协调" },
  "posture": { "trunkTilt": 2.1, "shoulderSlope": 1.4, "label": "直立挺拔" },
  "postureCautions": ["轻度圆肩"],
  "segmentationUsed": false,
  "surveyAnswered": true
}
```

---

## 六、raw（原始度量）

供调试、可视化与未来重算。**默认发送给 AI 的是裁剪版**（只留 `derived` 引用到的键），完整版留在本地 IndexedDB。

```jsonc
"raw": {
  "normalizer": { "type": "IOD", "valuePx": 128.4 },
  "metrics": {
    "threeCourts": { "upper": 0.341, "middle": 0.331, "lower": 0.328 },
    "fiveEye": 5.08,
    "innerGap": 1.03,
    "browLenRatio": { "left": 1.18, "right": 1.16 },
    "eyeAspect": { "left": 0.36, "right": 0.35 },
    "canthalTilt": { "left": 4.2, "right": 4.6 },
    "alarWidth": 0.74,
    "nostrilShow": 0.08,
    "mouthWidth": 1.02,
    "cornerLift": 0.041,
    "philtrumLen": 0.38
    // ...
  },
  "complexion": {
    "lab": { "forehead": [64.2, 12.1, 18.3], "cheekL": [63.8, 13.4, 17.9] },
    "aRel": 0.9, "bRel": 0.4, "uniformity": 0.88, "gloss": 0.06
  }
}
```

**Token 预算**：裁剪后 `raw` 控制在 ≤ 1 KB。若超出，按 `confidence` 降序保留前 20 项。

---

## 七、AI 响应契约

AI 返回 **Markdown 正文**（流式），不返回 JSON。理由：
- 星级评分由本地 `scorecard` 提供，无需 AI 生成 → 保证一致性
- Markdown 可流式渲染，首字延迟低，体验更好
- 免去部分 JSON 解析的复杂度与失败模式

正文结构由 System Prompt 强约束（见 `04-prompts.md` 第四节），前端按 `##` 二级标题切分成可折叠卡片。

**追问（多轮）**：同样返回 Markdown，但不重复报告结构，只答所问 + 结尾免责一句。

---

## 八、Schema 文件清单

| 文件 | 说明 |
|---|---|
| `schemas/analysis-envelope.schema.json` | 统一信封 + FeatureItem + UnavailableItem |
| `schemas/mianxiang.derived.schema.json` | 面相 derived |
| `schemas/shouxiang.derived.schema.json` | 手相 derived |
| `schemas/guxiang.derived.schema.json` | 骨相 derived |
| `schemas/tixiang.derived.schema.json` | 体相 derived |

TypeScript 类型由 `json-schema-to-typescript` 生成到 `src/types/analysis.d.ts`，构建时校验（`ajv`）确保发送前 payload 合法。

**ajv 配置**（已实测，五个 Schema 全部编译通过、本文档全部示例校验通过）：
```ts
new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: true })
// allowUnionTypes 是必需的：FeatureItem.value 为 string|number，
// Subject.ageBand / derived 中多处为 T|null，ajv 严格模式默认拒绝联合类型。
addFormats(ajv);   // 需要 ajv-formats 支持 uuid / date-time
```

---

## 九、完整示例（面相，精简版）

```json
{
  "schemaVersion": "1.0.0",
  "analysisType": "mianxiang",
  "analysisId": "8f2c1e40-6a3b-4d21-9c77-0e5b1a9d3f22",
  "capturedAt": "2026-08-01T10:22:00+08:00",
  "locale": "zh-CN",
  "subject": { "ageBand": "26-35", "gender": "unspecified", "isSelf": true, "focusTopics": ["事业"] },
  "capture": {
    "shots": ["front"],
    "quality": {
      "score": 0.86, "resolution": "ok", "lighting": "ok", "sharpness": "ok",
      "pose": { "yaw": -3.2, "pitch": 4.1, "roll": 1.0 },
      "occlusion": ["hair_covers_forehead"],
      "issues": ["额头部分被头发遮挡，上停测量置信度下降"]
    }
  },
  "features": [
    {
      "id": "face.threeCourts.balance", "category": "三停", "label": "三停平均",
      "band": "balanced", "value": "34.1% : 33.1% : 32.8%", "status": "measured", "confidence": 0.72,
      "evidence": "上停 34.1%，中停 33.1%，下停 32.8%，两两差值均 ≤ 1.3%",
      "meaning": "一生运势平稳，各阶段无显著起落", "source": "麻衣神相"
    },
    {
      "id": "face.brow.length", "category": "眉", "label": "眉长过目",
      "band": "high", "value": 1.17, "status": "measured", "confidence": 0.93,
      "evidence": "眉长为同侧眼长的 1.17 倍（阈值 ≥ 1.15）",
      "meaning": "传统主兄弟朋友情深、助力较多", "source": "麻衣神相"
    },
    {
      "id": "face.nose.tipFullness", "category": "鼻", "label": "准头丰圆",
      "band": "high", "value": 0.68, "status": "inferred", "confidence": 0.52,
      "evidence": "鼻尖相对鼻梁的深度突出量与高光面积综合评分 0.68",
      "meaning": "财帛宫佳，善于积累，正财稳健", "source": "神相全编"
    },
    {
      "id": "face.complexion.overall", "category": "气色", "label": "红润有光泽",
      "band": "high", "value": "a*相对值 +0.9，均匀度 0.88", "status": "inferred", "confidence": 0.41,
      "evidence": "颧部相对全脸红度 +0.9，明度均匀度 0.88，高光占比 6%",
      "meaning": "气血调和，近期状态在线", "source": "麻衣神相"
    }
  ],
  "derived": {
    "fiveElements": { "primary": "土", "primaryScore": 0.62, "secondary": "金", "secondaryScore": 0.41 },
    "faceShape": "国字脸", "courtDominance": "balanced", "symmetryScore": 0.91,
    "palaceHighlights": ["财帛宫", "官禄宫"], "palaceCautions": ["迁移宫"]
  },
  "raw": {
    "normalizer": { "type": "IOD", "valuePx": 128.4 },
    "metrics": { "fiveEye": 5.08, "innerGap": 1.03, "alarWidth": 0.74, "cornerLift": 0.041 }
  },
  "unavailable": [
    { "id": "face.ear.all", "label": "耳相", "reason": "not_observable",
      "detail": "正面照中双耳被头发遮挡，且面部网格不含耳廓细节点" },
    { "id": "face.scar", "label": "疤痕", "reason": "out_of_scope",
      "detail": "疤痕与痣的像素特征相近，本版本不作区分" }
  ],
  "scorecard": { "气度格局": 4, "才智思辨": 4, "人际情感": 4, "执行意志": 4, "根基福泽": 3 },
  "policy": {
    "disclaimerRequired": true,
    "forbidTopics": ["寿命", "疾病诊断", "具体事件时间", "婚姻成败", "生育", "政治"]
  }
}
```
