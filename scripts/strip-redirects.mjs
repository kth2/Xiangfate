/**
 * 构建后强制清除 dist 里的 _redirects。
 *
 * 背景：Cloudflare Workers 的静态资源服务会把 /index.html 规范化成 /，
 * 所以通用的 SPA 写法 `/*  /index.html  200` 重写之后又会匹配回 /*，
 * 被判定为无限循环，整个部署失败（错误码 100324）。
 * 本项目的 SPA 回退在三家各有各的机制，压根不需要这个文件：
 *   Cloudflare → wrangler 的 not_found_handling = "single-page-application"
 *   Vercel     → vercel.json 的 rewrites
 *   Netlify    → netlify.toml 的 [[redirects]]
 *
 * 为什么需要这个脚本：文件已经从仓库里删掉了，但 Cloudflare 的构建机会
 * 「Restoring from build output cache」，旧的 dist/_redirects 可能被缓存带回来，
 * 而 wrangler 是直接扫描 dist 目录来决定上传哪些资源的。
 * 挂在 postbuild 上，每次 `npm run build` 之后都会跑一遍 —— 包括 wrangler
 * 自己再次触发的那一次，所以它一定跑在资源扫描之前。
 *
 * 顺带把命中情况打进构建日志：如果真的清掉了文件，日志里就能看到，
 * 也就确认了残留来自构建缓存而不是别处。
 */

import { rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const targets = ['../dist/_redirects', '../public/_redirects'].map((p) =>
  fileURLToPath(new URL(p, import.meta.url)),
)

let removed = 0
for (const path of targets) {
  if (!existsSync(path)) continue
  const size = (await stat(path)).size
  await rm(path, { force: true })
  removed++
  console.warn(
    `[cleanup] 清除了残留的 ${path.split('/').slice(-2).join('/')}（${size} 字节）—— ` +
      '它会让 Cloudflare 部署因无限循环失败，本项目不使用这个文件',
  )
}

if (removed === 0) {
  console.log('[cleanup] 未发现 _redirects 残留 ✓')
}
