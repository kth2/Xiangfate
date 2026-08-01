# 06 · 技术架构与目录结构

> 第二步「项目初始化」的实施依据。

---

## 一、技术选型

### 1.1 采纳用户建议的部分

| 项 | 选型 | 说明 |
|---|---|---|
| 框架 | **React 19 + TypeScript 5.7 + Vite 7** | 按建议 |
| 样式 | **Tailwind CSS 4** | 按建议。v4 用 CSS-first 配置，无需 `tailwind.config.js` |
| 面部检测 | **MediaPipe Face Landmarker** | 按建议。478 点含虹膜，优于 dlib 68 点 |
| 手部检测 | **MediaPipe Hand Landmarker** | 按建议 |
| 姿态检测 | **MediaPipe Pose Landmarker** | 按建议 |
| 状态管理 | **Zustand** | 按建议。比 Context 更适合跨页共享分析会话 |
| AI | **Gemini 2.5 Flash**（默认）+ OpenRouter（备选） | 按建议 |
| 部署 | **Vercel** 或 **Cloudflare Pages** | 按建议 |

统一依赖：`@mediapipe/tasks-vision@1.0.1`（实测最新稳定版，2026-07-31 发布，
`FaceLandmarker` / `HandLandmarker` / `PoseLandmarker` 全部导出）。

### 1.2 提出的调整（附理由）

用户要求「如果某个技术点有更好的现代替代方案，可以提出并说明理由后采用」，以下是四点建议：

#### ① 路由：最终选了 React Router 7（原提案是 TanStack Router）

**原提案理由**：分析流程强线性，TanStack Router 的类型安全 search params 能把流程状态
放进 URL 并获得完整类型推导。

**实际落地时改了主意**：分析会话状态实际住在 Zustand（`analysis.store`），URL 只需要
携带 `analysisType` 一个参数。类型安全 search params 的收益因此很有限，不值得多一层
codegen 与心智负担。已采用 **React Router 7**（`createBrowserRouter` + 路由级
`lazy` 分包）。

#### ② 掌纹管线自研，不引入 OpenCV.js

**理由**：OpenCV.js 完整包 ~8–9 MB（WASM），几乎等于三个 MediaPipe 模型的总和，
而我们只需要其中 5 个算子：CLAHE、Gabor 卷积、自适应阈值、形态学、Zhang-Suen 细化。
手写这 5 个算子约 400 行 TypeScript，跑在 Web Worker + OffscreenCanvas 里，
体积 < 15 KB。对 PWA 首屏与安装体积的收益是决定性的。
**风险**：自研算子需要写单元测试（用合成图像验证）。已列入实现清单。

#### ③ AI 调用走 Provider 抽象层，不直接绑 Gemini SDK

**理由**：需求里已经提到「Gemini 或 OpenRouter 免费模型」，未来还可能换。定义一个
`AIProvider` 接口（`stream(messages, opts): AsyncIterable<string>`），下面挂
`GeminiProvider` / `OpenRouterProvider` / `ProxyProvider` 三个实现。切换模型只改配置。
同时这层是加 `guard.ts` 后置校验的天然位置。

#### ④ API Key 两种模式，默认 BYO Key

**理由**：这是**必须提前决定的安全问题**。浏览器直连 AI 服务会把 Key 暴露给任何打开
DevTools 的人。

| 模式 | 适用 | 实现 |
|---|---|---|
| **BYO Key**（默认，MVP） | 自用、内测、开源自部署 | 用户在设置页填自己的 Key，存 `localStorage`，浏览器直连。Key 是用户自己的，暴露只影响他自己 |
| **代理模式**（公开部署必须） | 面向公众的正式版 | Vercel Edge Function / Cloudflare Worker 持有 Key，加 IP 限流 + 每日配额 + Origin 校验；前端不接触 Key |

代码里两种模式共用 `AIProvider` 接口，通过 `VITE_AI_MODE=byok|proxy` 切换。
README 必须把这件事写清楚——**不能让人误以为直接 `VITE_GEMINI_API_KEY` 部署上线是安全的**
（Vite 的 `VITE_` 前缀变量会被打进前端包）。

### 1.3 关于「以后转 Flutter / RN / Kotlin」

现在就要为迁移留好接缝。做法：**把纯计算逻辑与 UI 彻底分离**。

```
src/core/      ← 纯 TS，零 DOM 依赖，零 React 依赖
src/modules/   ← 纯 TS 规则与度量
src/ui/        ← React 组件
```

`core` 与 `modules` 里的东西（规则表、阈值、Schema、Prompt、评分卡、guard）
在迁移时可以：
- 转 **React Native** → 直接复用（MediaPipe 有 RN 绑定）
- 转 **Flutter** → 规则表是纯数据，翻译成 Dart 是机械工作；或直接跑在 WebView/JS 引擎里
- 转 **Kotlin** → 同上，MediaPipe Android 原生支持更好

**硬性约定**：`src/core` 和 `src/modules` 下不允许 `import React`，也不允许直接碰
`document` / `window`（图像处理通过传入的 `ImageData` 操作）。用 ESLint `no-restricted-imports` 强制。

---

## 二、目录结构

```
Xiangfate/
├── docs/                                # 第一步产出（本目录）
│   ├── 01-research-kanxiang.md
│   ├── 02-feature-rules.md
│   ├── 03-schema.md
│   ├── 04-prompts.md
│   ├── 05-capture-guide.md
│   ├── 06-architecture.md
│   └── 07-content-policy.md
├── schemas/                             # JSON Schema
│   ├── analysis-envelope.schema.json
│   ├── mianxiang.derived.schema.json
│   ├── shouxiang.derived.schema.json
│   ├── guxiang.derived.schema.json
│   └── tixiang.derived.schema.json
├── public/
│   ├── manifest.webmanifest
│   └── icons/
├── scripts/
│   ├── verify-landmarks.ts              # 校验 MediaPipe 索引表
│   └── gen-types.ts                     # JSON Schema → TS 类型
└── src/
    ├── core/                            # ⚠️ 纯 TS，无 React / DOM
    │   ├── types.ts                     # 由 schemas 生成
    │   ├── quality.ts                   # 质量门控与 confidence 计算
    │   ├── scorecard.ts                 # 本地五维评分
    │   ├── guard.ts                     # AI 输出后置校验
    │   ├── guard.rules.ts               # 禁用词表（与 07 同源）
    │   ├── band.ts                      # 分档工具
    │   └── color.ts                     # sRGB→Lab、气色采样
    ├── modules/                         # ⚠️ 纯 TS，四大类各自独立
    │   ├── mianxiang/
    │   │   ├── landmarks.ts             # 478 点索引常量
    │   │   ├── metrics.ts               # 几何度量
    │   │   ├── complexion.ts            # 气色
    │   │   ├── palaces.ts               # 十二宫
    │   │   ├── rules.ts                 # 度量 → FeatureItem
    │   │   ├── thresholds.ts            # 所有阈值（可调）
    │   │   └── capture.config.ts
    │   ├── shouxiang/
    │   │   ├── landmarks.ts
    │   │   ├── normalize.ts             # 单应变换 → 标准掌画布
    │   │   ├── palmlines.ts             # 掌纹归类与度量
    │   │   ├── mounts.ts                # 掌丘
    │   │   ├── metrics.ts
    │   │   ├── rules.ts
    │   │   ├── thresholds.ts
    │   │   └── capture.config.ts
    │   ├── guxiang/                     # 派生模块，依赖 mianxiang + tixiang 的 metrics
    │   │   ├── metrics.ts
    │   │   ├── boneflesh.ts
    │   │   ├── rules.ts
    │   │   ├── thresholds.ts
    │   │   └── capture.config.ts
    │   └── tixiang/
    │       ├── landmarks.ts
    │       ├── metrics.ts               # 一律用 worldLandmarks
    │       ├── posture.ts
    │       ├── somatotype.ts
    │       ├── survey.ts                # 自评问卷
    │       ├── rules.ts
    │       ├── thresholds.ts
    │       └── capture.config.ts
    ├── cv/                              # 自研图像算子（纯 TS，无依赖）
    │   ├── clahe.ts
    │   ├── gabor.ts
    │   ├── threshold.ts
    │   ├── morphology.ts
    │   ├── thinning.ts                  # Zhang-Suen
    │   ├── trace.ts                     # 骨架 → polyline
    │   └── homography.ts
    ├── workers/
    │   └── palmline.worker.ts           # 掌纹管线（cv/* 的编排）
    ├── mediapipe/
    │   ├── loader.ts                    # 懒加载 + Cache Storage 持久化
    │   ├── face.ts
    │   ├── hand.ts
    │   └── pose.ts
    ├── ai/
    │   ├── provider.ts                  # AIProvider 接口
    │   ├── gemini.ts
    │   ├── openrouter.ts
    │   ├── proxy.ts
    │   └── session.ts                   # 多轮上下文管理 + token 预算
    ├── prompts/
    │   ├── system.ts
    │   ├── mianxiang.ts
    │   ├── shouxiang.ts
    │   ├── guxiang.ts
    │   ├── tixiang.ts
    │   └── followup.ts
    ├── store/
    │   ├── analysis.store.ts            # 当前分析会话
    │   ├── history.store.ts             # 历史记录（IndexedDB）
    │   └── settings.store.ts            # API Key、模型、语言
    ├── db/
    │   └── idb.ts                       # IndexedDB 封装
    ├── copy/
    │   ├── capture.zh-CN.ts
    │   └── disclaimer.zh-CN.ts
    ├── ui/
    │   ├── pages/
    │   │   ├── Home.tsx                 # 四大入口
    │   │   ├── Capture.tsx              # 通用拍摄页（按 capture.config 驱动）
    │   │   ├── Extracting.tsx           # 提取中 + 关键点可视化
    │   │   ├── Report.tsx               # 报告页
    │   │   ├── History.tsx
    │   │   └── Settings.tsx
    │   ├── components/
    │   │   ├── LandmarkOverlay.tsx      # 关键点/掌线/骨架叠加层
    │   │   ├── PalmLineCorrector.tsx    # 掌纹手动校正
    │   │   ├── ScoreCard.tsx
    │   │   ├── FeatureList.tsx
    │   │   ├── ReportSection.tsx
    │   │   ├── FollowUpChat.tsx
    │   │   └── Disclaimer.tsx
    │   └── hooks/
    └── main.tsx
```

---

## 三、数据流

```
Home（选类型）
   ↓ analysisType
Capture（按 capture.config 驱动的通用拍摄页）
   ↓ ImageBitmap[]（内存中，不落盘）
mediapipe/loader（懒加载对应模型，Cache Storage 命中则秒开）
   ↓ landmarks
core/quality（质量门控 → quality 对象 + confidence 基数）
   ↓
modules/<type>/metrics（几何度量）      ┐
modules/<type>/complexion（像素采样）   ├→ raw
workers/palmline（仅手相，Worker）      ┘
   ↓
modules/<type>/rules（度量 → FeatureItem[] + derived + unavailable[]）
   ↓
core/scorecard（本地五维评分）
   ↓
【AnalysisEnvelope JSON】────────────┐
   ↓                                 │
Extracting（叠加层可视化，用户确认）    │  ImageBitmap 在此步之后
   ↓                                 │  显式 close()，不进入任何持久化
prompts/<type>（拼 User Prompt）      │
   ↓                                 │
ai/provider（流式请求）                │
   ↓                                 │
core/guard（后置校验）                 │
   ↓                                 │
Report（渲染 + 自动附加免责声明）       │
   ↓                                 │
db/idb（存 envelope + 报告文本，不存图）←┘
   ↓
FollowUpChat（多轮追问）
```

**关键约束**：`ImageBitmap` / `ImageData` 只在内存中存在，`Extracting` 页结束后
显式调用 `.close()`。**IndexedDB 里绝不写入任何图像数据。** 历史记录只存
`AnalysisEnvelope` + 报告 Markdown + 一个本地生成的抽象缩略图（如面部关键点线稿，
不含像素信息）。

---

## 四、PWA 与模型缓存

| 项 | 方案 |
|---|---|
| Service Worker | `vite-plugin-pwa`（Workbox） |
| 应用壳 | Precache，`registerType: 'autoUpdate'`。实测 **489 KiB / 19 项** |
| MediaPipe WASM | **不 precache**。实测单个 `vision_wasm_internal.wasm` 就有 **11.7 MB**（远超原估的 3 MB），改为 `CacheFirst` 运行时缓存 |
| `.task` 模型文件 | **不 precache**（共 17 MB）。用 `CacheFirst` 运行时缓存，`maxAgeSeconds: 90 天`。首次用到某类型才下载 |

**WASM 的加载方式（实现时踩到的坑）**：
`@mediapipe/tasks-vision` 的 `exports` 字段**没有导出 `./wasm` 目录**，
`new URL('@mediapipe/tasks-vision/wasm', import.meta.url)` 会直接构建失败。
两条出路：走 jsDelivr CDN，或复制到自己的 `public/`。
**选了后者** —— 走自己的域名才能真正离线可用，也不受第三方 CDN 可用性影响。
由 `scripts/copy-mediapipe-wasm.mjs` 在 `postinstall` / `prebuild` 时从 `node_modules`
复制到 `public/mediapipe/wasm/`（约 34 MB，已 gitignore，不入库）。
| 离线能力 | 应用壳 + 已缓存模型可离线做特征提取；AI 解读需联网，离线时把 envelope 存入队列，联网后提示继续 |
| 安装引导 | 捕获 `beforeinstallprompt`；iOS 单独出「添加到主屏幕」图文引导（iOS 不支持该事件） |

`manifest.webmanifest` 要点：`display: standalone`、`orientation: portrait`、
`theme_color` 跟随暗色/亮色、`shortcuts` 配四大类型直达入口。

---

## 五、性能预算

| 阶段 | 目标 | 手段 |
|---|---|---|
| 首屏 JS | < 200 KB gzip | 路由级 code split；MediaPipe 与 cv 全部动态 import。**实测 ≈ 100 KB gzip** ✅ |
| 模型加载（首次） | 面相 3.6 MB / 手相 7.5 MB / 体相 5.5 MB（+ wasm 11.7 MB，四类共用一次） | 懒加载 + 进度条 + Cache 持久化 |
| 模型加载（二次） | < 300 ms | Cache Storage |
| 关键点检测 | < 300 ms（IMAGE 模式） | GPU delegate，失败回落 CPU |
| 掌纹管线 | < 500 ms | Web Worker + OffscreenCanvas + 可分离 Gabor 核 |
| 特征规则计算 | < 20 ms | 纯数值运算 |
| AI 首字延迟 | < 2 s | 流式；Prompt 控制在 ≈ 2.2k token |
| 报告完整生成 | < 15 s | — |

---

## 六、环境变量

```bash
# .env.example
VITE_AI_MODE=byok                    # byok | proxy
VITE_DEFAULT_PROVIDER=gemini         # gemini | openrouter
VITE_DEFAULT_MODEL=gemini-2.5-flash

# proxy 模式下前端只需要知道代理地址，不接触 Key
VITE_PROXY_ENDPOINT=/api/analyze

# ⚠️ 以下仅用于本地开发。VITE_ 前缀的变量会被打进前端产物，
#    绝对不要在公开部署时使用真实 Key。
# VITE_GEMINI_API_KEY=
```

代理端（Vercel Edge Function，不带 `VITE_` 前缀，仅服务端可见）：
```bash
GEMINI_API_KEY=
OPENROUTER_API_KEY=
RATE_LIMIT_PER_IP_PER_DAY=20
ALLOWED_ORIGINS=https://xiangfate.vercel.app
```

---

## 七、测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| CV 算子 | Vitest | 合成图像（已知答案的直线/圆弧）验证 Gabor / 细化 / 追踪 |
| 度量函数 | Vitest | 固定 landmark 数组 → 期望数值（黄金测试） |
| 规则映射 | Vitest | 阈值边界值全覆盖（每条规则的 band 分界点） |
| guard | Vitest | 禁用词、缺标题、超长、`unavailable` 泄漏的用例 |
| Schema | ajv | 每个模块产出的 envelope 必须通过校验 |
| E2E | Playwright | 四条主流程（上传固定测试图 → 出报告），AI 调用 mock |

**测试用图**：需要准备 4 组固定测试照片放 `tests/fixtures/`（用公开授权图或合成图，
**不要用真人隐私照片**）。这也是回归测试的基线。

---

## 八、执行顺序与进度

### 第二步（已完成）
1. ✅ Vite + React 19 + TS + Tailwind 4 + Zustand + React Router，跑通空壳
2. ✅ `schemas/` 落地 + 手写 `core/types.ts`，用 `core/__tests__/schema.test.ts` 守住一致性
   （手写而非 codegen：少一层构建依赖，代价是必须有测试兜底）
3. ✅ `mediapipe/loader.ts` 懒加载 + 进度 + 释放；`mediapipe/detect.ts` 三检测器统一封装
4. ✅ Home 页（四入口，显示各类型模型是否已缓存）
5. ✅ 通用 Capture 页：相机 / 相册 → 质量预处理 → 端侧检测 → 关键点可视化
6. ✅ 首启免责门、设置页（BYO Key）、关于页、深浅主题
7. ✅ PWA manifest + SW + 图标

### 第三步（已完成）
8. ✅ 478 点索引表已用规范网格几何证明（订正初稿 4 处错误）
9. ✅ 面相全链路（度量 → 规则 → JSON → Prompt → 报告），作为其他三类的模板
10. ✅ 体相（worldLandmarks 米制比例 + 可选自评）
11. ✅ 骨相（复用面相与体相的 metrics；不可观测的骨显式标记）
12. ✅ 手相（`cv/*` 全套自研算子 + Worker + 掌纹校正 UI）
13. ✅ `core/guard.ts` 输出后置校验、历史记录（IndexedDB）

### 第四步（进行中）
14. ✅ 部署配置：Vercel / Cloudflare Pages / Netlify 三家都已配好
15. ⏳ **阈值校准** —— 需要真机采样。所有标 `CALIBRATE` 的阈值都等这一步
16. ⏳ 移动端适配打磨、权限处理、离线队列
