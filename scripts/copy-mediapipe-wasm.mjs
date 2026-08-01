/**
 * 把 @mediapipe/tasks-vision 的 wasm 运行时复制到 public/mediapipe/wasm。
 *
 * 为什么不直接 import：包的 exports 字段没有导出 ./wasm 目录，
 * `new URL('@mediapipe/tasks-vision/wasm', import.meta.url)` 会构建失败。
 *
 * 为什么不走 CDN：走自己的域名才能离线可用，也不受第三方 CDN 可用性影响。
 * 代价是 wasm 约 11.7MB（gzip 后小得多），因此它走运行时缓存而非预缓存。
 *
 * 产物已 gitignore，由 prebuild / postinstall 生成。
 */

import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const src = fileURLToPath(new URL('../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url))
const dest = fileURLToPath(new URL('../public/mediapipe/wasm', import.meta.url))

if (!existsSync(src)) {
  console.error('[mediapipe] 找不到 wasm 目录，先跑 npm install')
  process.exit(1)
}

await mkdir(dest, { recursive: true })
await cp(src, dest, { recursive: true })

const files = await readdir(dest)
let total = 0
for (const f of files) {
  total += (await stat(`${dest}/${f}`)).size
}
console.log(
  `[mediapipe] 已复制 ${files.length} 个文件到 public/mediapipe/wasm（${(total / 1024 / 1024).toFixed(1)} MB）`,
)
