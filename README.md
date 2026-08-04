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
| 面相 | ✅ 真人脸验证 | 二维 25 项 + **三维 34 项**（规范帧 · 五岳 · 十二宫统计 · 3D 对称），检测 ≈ 3.5s |
| 体相 | ✅ 已接通 | worldLandmarks 米制比例 + 可选自评问卷 |
| 骨相 | ✅ 已接通 | 正面 + 侧面推估；枕骨/顶骨/耳后骨显式标为未观测 |
| 手相 | ✅ 已接通 | 自研掌纹 CV 管线 + 手动校正兜底 |

实测：首屏 JS ≈ 100 KB gzip，应用壳预缓存 653 KiB，300 个测试全绿。

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
| [07 · 内容安全策略与免责设计](./docs/07-content-policy.md) | 四条硬边界、逐条清单、四道防线 |
| [附 · 求测问答知识库](./docs/xiangshu-qa-knowledge.md) | 求测者常问什么、术士怎么答；预设问题与追问 Prompt 的来源 |

机器可读的 JSON Schema 在 [`schemas/`](./schemas)（Draft 2020-12，已用 ajv 校验通过）。
当前 **schema 2.0**：新增字段一律可选，1.0 的历史记录照常读取。

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

相术的判断本来就有褒有贬。传统相书里说的心机深、城府深、六亲缘薄、性情急躁、忌相，
本项目**照原意呈现** —— 一份只会说好话的相书不是相书。

不写的只有四类硬边界：疾病诊断、寿夭生死、性别化的婚配归咎（克夫/旺夫）、
身材与残障贬损。[`docs/07`](./docs/07-content-policy.md) 有逐条清单，外加四道防线：
数据源头 → Prompt 约束 → 输出后置校验 → UI 强制免责。危机关键词拦截与免责声明不受影响。

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

### 关于模型选择

模型列表**从服务商 API 实时拉取**，不是写死在代码里的 ——
服务商上了新模型，刷新一下就能选到。

- **Gemini**：调 `models.list`，需要先填 Key；自动滤掉 embedding / imagen / TTS 这类非对话模型
- **OpenRouter**：`GET /models` 是公开端点，不填 Key 也能浏览；免费模型排在最前并打「免费」标
- 列表本地缓存 24 小时，随时可以点「刷新列表」取最新
- 拉不到时回落到缓存或内置兜底清单，界面上会标明来源
- 任何时候都能**手动填模型 ID**，不被我们的列表限制
- 选中的模型如果不在服务商的实时列表里（下线或改名），会明确警告

「高级设置」里可以覆盖**接口地址**，走自建代理或镜像时用得上，留空即默认。

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

推荐 **Vercel** 或 **Netlify**，两家都已配好，导入仓库即可。
部署后拿到的 HTTPS 地址在手机浏览器打开，再「添加到主屏幕」，就是可安装的 PWA。

### Vercel（推荐）

**方式一：网页导入，不用装任何东西**
1. 打开 <https://vercel.com/new>
2. 选这个仓库 → Import
3. 框架会自动识别为 Vite，构建命令与输出目录都由 `vercel.json` 指定，**什么都不用改**
4. Deploy

**方式二：命令行**
```bash
npm i -g vercel
vercel --prod
```

`vercel.json` 里已经配好 SPA 回退、静态资源长缓存，以及
`Permissions-Policy: camera=(self)`（手机上要相机权限，这条是必需的）。

**SPA 回退**用的是 `/(.*) → /index.html`。Vercel 会先匹配静态文件、
匹配不到才走 rewrite，所以这条 catch-all 不会拦截 `/assets/*` 与 `/mediapipe/*`。

> ⚠️ `vercel.json` 是严格 JSON，**不能写注释，也不能加任何自造的键**
> （比如 `_comment`）—— Vercel 的 schema 会拒绝未知属性，直接部署失败。
> 说明文字一律写在这份 README 里。
> `src/core/__tests__/deploy-config.test.ts` 会检查这一点。

### Netlify

导入仓库即可，`netlify.toml` 已配好 SPA 回退与缓存头。
Build command `npm run build`，publish directory `dist`。

### Cloudflare（⚠️ 已知会卡住，建议避开）

Cloudflare Workers 的静态资源服务对 `_redirects` 的处理有个坑：它会把
`/index.html` 规范化成 `/`，于是通用的 SPA 写法 `/*  /index.html  200`
会重新匹配回 `/*`，被判定为无限循环，部署直接失败（错误码 **100324**）。

本项目已经完全不用这个文件了 —— `public/_redirects` 已删除，`postbuild`
还挂了 `scripts/strip-redirects.mjs` 强制清除任何残留。但实际部署中该报错
仍然复现过，怀疑与 Cloudflare 的构建缓存或资源存储有关，**尚未定位**。

如果你一定要用 Cloudflare，可以试试：
- Settings → Build → 清一次 build cache 后重试
- 确认构建对应的 commit 确实包含了删除 `_redirects` 的那一版
- 看构建日志里 `[cleanup]` 那一行，判断残留到底有没有被拦下

在这个问题定位清楚之前，用 Vercel 或 Netlify 更省事。

### 部署体积说明

产物约 **23 MB / 26 个文件**，其中 22 MB 是 `public/mediapipe/` 里的 wasm
运行时，由 `postinstall` 从 `node_modules` 复制而来（不入库）。
只复制真正会被加载的两个变体 —— `FilesetResolver` 的路径拼装逻辑决定了
`_module_` 那一套永远不会被请求，排除它省下约 12 MB。

三个 `.task` 模型（共约 17 MB）不打进包，首次用到某个类型时才从 Google 的
CDN 下载，之后由 Service Worker 缓存 90 天。

---

## 技术栈

React 19 · TypeScript · Vite · Tailwind CSS 4 · Zustand · React Router 7 ·
`@mediapipe/tasks-vision@1.0.1` · Google Gemini / OpenRouter · vite-plugin-pwa · idb

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
- 相机路径会连拍 5 帧用于降噪，这些帧同样只在内存里，取完关键点立刻 `close()`
- 上传路径会剥离全部 EXIF（含 GPS）
- 发送给 AI 的只有结构化数值特征，**不含任何关键点原始坐标**
- 历史记录存在本地 IndexedDB，可一键清除
- 无埋点、无分析 SDK

---

## License

MIT
