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

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const src = fileURLToPath(new URL('../node_modules/@mediapipe/tasks-vision/wasm', import.meta.url))
const dest = fileURLToPath(new URL('../public/mediapipe/wasm', import.meta.url))

/**
 * 只复制真正会被加载的两个变体。
 * FilesetResolver.forVisionTasks(path) 的路径拼装逻辑是：
 *   `vision_wasm${module ? '_module' : ''}${simd ? '' : '_nosimd'}_internal`
 * 我们从不传第二个参数（module=false），所以 `_module_` 那一套永远不会被请求。
 * 排除它能省下约 12MB 部署体积。
 */
const NEEDED = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

if (!existsSync(src)) {
  console.error('[mediapipe] 找不到 wasm 目录，先跑 npm install')
  process.exit(1)
}

await mkdir(dest, { recursive: true })

let total = 0
for (const f of NEEDED) {
  const from = `${src}/${f}`
  if (!existsSync(from)) {
    console.error(`[mediapipe] 缺少 ${f} —— tasks-vision 的文件结构可能变了，检查一下版本`)
    process.exit(1)
  }
  await copyFile(from, `${dest}/${f}`)
  total += (await stat(`${dest}/${f}`)).size
}

console.log(
  `[mediapipe] 已复制 ${NEEDED.length} 个文件到 public/mediapipe/wasm（${(total / 1024 / 1024).toFixed(1)} MB）`,
)
