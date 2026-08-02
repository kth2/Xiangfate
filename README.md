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
- [x] **第三步：核心功能开发** —— **四大类特征管线全部打通** + AI 解读 + 追问 + 本地历史
- [~] 第四步：上线与校准 —— 部署配置已就绪；**阈值校准待真机采样后进行**

**完整链路**（真实浏览器验证）：
选类型 → 拍照/上传 → EXIF 剥离 → 按需下载模型 → 关键点检测 → 质量门控 →
几何度量 / CV 提取 → 规则映射 → 结构化 JSON → AI 流式解读 → 输出后置校验
→ 报告 + 追问 → 本地历史。

| 类型 | 状态 | 说明 |
|---|---|---|
| 面相 | ✅ 真人脸验证 | 22 项实测特征 + 3 项未观测，检测 ≈ 3.5s |
| 体相 | ✅ 已接通 | worldLandmarks 米制比例 + 可选自评问卷 |
| 骨相 | ✅ 已接通 | 正面 + 侧面推估；枕骨/顶骨/耳后骨显式标为未观测 |
| 手相 | ✅ 已接通 | 自研掌纹 CV 管线 + 手动校正兜底 |

实测：首屏 JS ≈ 100 KB gzip，应用壳预缓存 633 KiB，107 个测试全绿。

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

> ⚠️ **手机上用必须走 HTTPS** —— 浏览器只在安全上下文里给相机权限。
> 本机开发时 `localhost` 算安全上下文；手机访问局域网 IP 则不算，
> 要么部署到线上（见下），要么用 `npm run dev -- --host` 配合隧道工具。

首次打开会有一个免责声明确认页。AI Key 在应用内的「设置」页填写，不需要 `.env`。

```bash
npm run typecheck   # tsc -b
npm test            # vitest：schema 一致性 + 分档边界 + 注册表约束
npm run build       # 产物在 dist/
npm run preview
```

> `public/mediapipe/` 由 `scripts/copy-mediapipe-wasm.mjs` 生成（约 22 MB），已 gitignore。
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

## 部署

三家都配好了，选一个即可。部署后拿到的 HTTPS 地址在手机浏览器打开，
再「添加到主屏幕」，就是一个可安装的 PWA。

### Vercel（推荐）

```bash
npm i -g vercel
vercel            # 首次会问几个问题，一路默认即可
vercel --prod
```
配置在 `vercel.json`：SPA 回退、静态资源长缓存、`Permissions-Policy: camera=(self)`。

### Cloudflare（Workers 静态资源 / Pages）

在控制台新建项目并连上仓库，然后填：
- **Build command**：`npm run build`
- **Build output directory**：`dist`
- **Node 版本**：22

Header 走 `public/_headers`（构建时被复制进 `dist/`）。

**SPA 回退由 `wrangler.jsonc` 的 `not_found_handling` 负责**，不要用 `_redirects`：

```jsonc
{
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

> ⚠️ **踩过的坑**：本项目一度在 `public/_redirects` 里放了通用的 SPA 写法
> `/*  /index.html  200`。Cloudflare 的静态资源服务会把 `/index.html`
> 规范化成 `/`，于是这条规则又匹配回 `/*`，被判定为无限循环，
> 整个部署直接失败（错误码 **100324**）。
> 现在这条规则只留在 `netlify.toml` 里，Cloudflare 和 Vercel 各用各的机制。
>
> `postbuild` 上挂了 `scripts/strip-redirects.mjs` 作为兜底：每次构建后强制
> 清除 `dist/_redirects`。Cloudflare 构建机会「Restoring from build output cache」，
> 万一旧文件被缓存带回来，这一步能拦住。构建日志里会打印是否命中，
> 便于判断残留到底来自缓存还是别处。

**如果部署仍然报 100324**，八成是构建跑的不是最新提交（Cloudflare 的构建可能排队，
或者手动重跑了某个旧 deployment）。确认一下 CF 控制台里那次构建对应的 commit
是不是包含了删除 `public/_redirects` 的那一版；也可以在 CF 的
Settings → Build → 清一次 build cache 再重试。

### Netlify

连上仓库即可，`netlify.toml` 已经配好（SPA 回退 + 缓存头都在里面）。

### 部署体积说明

`public/mediapipe/` 里的 wasm 运行时约 **22 MB**，由 `postinstall` 从 `node_modules`
复制而来（不入库）。只复制真正会被加载的两个变体 —— `FilesetResolver` 的路径拼装
逻辑决定了 `_module_` 那一套永远不会被请求，排除它省下约 12 MB。

三个 `.task` 模型（共约 17 MB）不打进包，首次用到某个类型时才从 Google 的
CDN 下载，之后由 Service Worker 缓存 90 天。

---

## 技术栈

React 19 · TypeScript · Vite · Tailwind CSS 4 · Zustand · React Router 7 ·
`@mediapipe/tasks-vision@1.0.1` · Gemini 2.5 Flash / OpenRouter · vite-plugin-pwa · idb

掌纹提取是自研的 CV 管线（CLAHE → Gabor 滤波器组 → 自适应阈值 → 形态学 →
Zhang-Suen 细化 → 骨架追踪），跑在 Web Worker 里。
不引 OpenCV.js：完整包约 8–9 MB，而我们只需要其中 5 个算子，手写约 400 行、
打包后 < 15 KB。

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
