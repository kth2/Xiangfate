# 相由 · Xiangfate

> AI 传统相术分析 PWA —— 面相 · 手相 · 骨相 · 体相

⚠️ **本应用仅供娱乐与传统文化参考，不构成任何决策建议。**
相术属于传统文化范畴，现代科学尚未证实其预测能力。

---

## 这是什么

一个跑在浏览器里的传统相术分析应用。你选一种相术类型、拍一张照片，
应用会**在你的设备本地**用 MediaPipe 提取几何特征，把算出来的**结构化数值**
（不是照片）发给 AI，生成一份基于《麻衣神相》《神相全编》《冰鉴》等
经典相书的解读报告，并支持继续追问。

**照片不会离开你的设备。**

| 类型 | 需要的照片 | 端侧模型 |
|---|---|---|
| 面相 | 正面人脸 | MediaPipe Face Landmarker（478 点） |
| 手相 | 手掌正面（1–2 张） | MediaPipe Hand Landmarker（21 点）+ 自研掌纹 CV 管线 |
| 骨相 | 正面 + 侧面人脸，可选体照 | Face + Pose（派生模块，无专用骨骼模型） |
| 体相 | 全身或半身 | MediaPipe Pose Landmarker（33 点） |

---

## 当前进度

- [x] **第一步：研究与总结** —— 见 [`docs/`](./docs)
- [x] **第二步：项目初始化** —— 首页四入口 · 端侧检测跑通 · PWA 骨架 · BYO Key 设置
- [~] **第三步：核心功能开发** —— **面相全链路已打通**；手相/骨相/体相的特征管线待接
- [ ] 第四步：体验与上线准备

**面相已跑通的完整链路**（真实浏览器验证）：
选类型 → 拍照/上传 → EXIF 剥离 → 按需下载模型 → 478 点检测 → 质量门控 →
几何度量 → 规则映射 → 结构化 JSON → AI 流式解读 → 输出后置校验 → 报告 + 追问 → 本地历史。

实测：首屏 JS ≈ 100 KB gzip，端侧检测 ≈ 3.5s（CPU），单张真人脸产出 22 项实测特征 + 3 项未观测。

---

## 文档

| 文档 | 内容 |
|---|---|
| [01 · 参考项目研究与差距分析](./docs/01-research-kanxiang.md) | timerzz/kanxiang 全貌、三个辅助项目、**能力差距表**（关键） |
| [02 · 四大类特征计算规则表](./docs/02-feature-rules.md) | 每条规则的度量公式、归一化、阈值、传统术语、出处 |
| [03 · 结构化 JSON Schema](./docs/03-schema.md) | 端侧与 AI 之间的唯一契约 |
| [04 · Prompt 设计](./docs/04-prompts.md) | System Prompt + 四类 User Prompt + 追问模板 |
| [05 · 照片要求与引导文案](./docs/05-capture-guide.md) | 各类型的硬性要求、实时提示、权限与失败处理 |
| [06 · 技术架构与目录结构](./docs/06-architecture.md) | 技术选型与理由、数据流、性能预算、执行顺序 |
| [07 · 内容安全策略与免责设计](./docs/07-content-policy.md) | 传统相书内容的逐条改写清单、四道防线 |

机器可读的 JSON Schema 在 [`schemas/`](./schemas)（Draft 2020-12，已用 ajv 校验通过）。

---

## 设计要点

### 与参考项目的本质区别

对标项目 [timerzz/kanxiang](https://github.com/timerzz/kanxiang) 是一个 Claude Code Skill：
把照片直接交给视觉大模型，让模型一边看图一边对照规则文本自由发挥。

本项目走的是另一条路：

|  | kanxiang | Xiangfate |
|---|---|---|
| 特征来源 | 视觉模型主观描述 | 端侧关键点 + 几何计算 + CV |
| 原图去向 | 上传给云端 | **不离开设备** |
| 结果可复现 | 否 | 是 |
| 置信度 | 无 | 每条特征都有 |

### 三条硬规则

1. **测得到才说，测不到就标记为不可用。** 每条特征都带 `status` 和 `confidence`，
   AI 只能基于 `measured` 的特征立论。骨相里的枕骨、顶骨、耳后骨在照片中根本不可见——
   我们会明写「未观测，不作论断」，而不是让模型编。
2. **数值先行，术语其次。** 先算出可复现的几何数值，再映射到传统术语
   （「三停比 1.02 : 0.99 : 0.99 → 三停平均」），报告里两者都给。
3. **确定性的归代码，生成式的归 AI。** 特征提取、分级、星级评分全部本地算死；
   AI 只负责把结构化特征翻译成有温度的传统相术语言。

### 内容安全

传统相书里有大量在今天属于人格污名、性别歧视、身材歧视和伪医学断言的内容
（「耳小薄削主短命」「颧骨高耸婚姻不顺」「掌色发黄主肝胆问题」）。
这些**不会**进入本项目的规则库。[`docs/07`](./docs/07-content-policy.md) 有逐条改写清单，
外加四道防线：数据源头过滤 → Prompt 约束 → 输出后置校验 → UI 强制免责。

---

## 本地运行

```bash
npm install     # postinstall 会把 MediaPipe wasm 复制到 public/mediapipe/wasm
npm run dev     # http://localhost:5173
```

首次打开会有一个免责声明确认页。AI Key 在应用内的「设置」页填写，不需要 `.env`。

```bash
npm run typecheck   # tsc -b
npm test            # vitest：schema 一致性 + 分档边界 + 注册表约束
npm run build       # 产物在 dist/
npm run preview
```

> `public/mediapipe/` 由 `scripts/copy-mediapipe-wasm.mjs` 生成（约 34 MB），已 gitignore。
> 之所以不走 CDN：走自己的域名才能真正离线可用。

### 关于 API Key

两种模式，通过 `VITE_AI_MODE` 切换：

| 模式 | 适用 | 说明 |
|---|---|---|
| `byok`（默认） | 自用、内测、自部署 | 用户在设置页填自己的 Key，存 `localStorage`，浏览器直连 |
| `proxy` | **公开部署必须** | Key 由 Edge Function 持有，加限流与 Origin 校验，前端不接触 Key |

⚠️ **重要**：Vite 中所有 `VITE_` 前缀的环境变量都会被打进前端产物。
不要把真实 API Key 放进 `VITE_GEMINI_API_KEY` 然后公开部署——任何人打开
DevTools 都能拿到。公开部署请用 `proxy` 模式。

---

## 技术栈

React 19 · TypeScript · Vite · Tailwind CSS 4 · Zustand ·
`@mediapipe/tasks-vision@1.0.1` · Gemini 2.5 Flash / OpenRouter · vite-plugin-pwa

---

## 知识来源

《麻衣神相》《柳庄相法》《神相全编》《水镜神相》《冰鉴》《太清神鉴》《人伦大统赋》

规则整理参考 [timerzz/kanxiang](https://github.com/timerzz/kanxiang)（MIT），
面部型态分类词表参考 [lincerely/Face-Reading](https://github.com/lincerely/Face-Reading)。

---

## 隐私

- 照片只在浏览器内存中处理，用完即 `close()`，**不上传、不落盘**
- 上传路径会剥离全部 EXIF（含 GPS）
- 发送给 AI 的只有结构化数值特征，**不含任何关键点原始坐标**
- 历史记录存在本地 IndexedDB，可一键清除
- 无埋点、无分析 SDK

---

## License

MIT
