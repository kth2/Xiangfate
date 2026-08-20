/**
 * 部署后的「旧壳请求新构建里已不存在的分片」。
 *
 * ── 症状 ──────────────────────────────────────────────
 *   Unexpected Application Error!
 *   Failed to fetch dynamically imported module: /assets/Report-XXXX.js
 *
 * ── 成因 ──────────────────────────────────────────────
 * 路由是 lazy 的，每个页面单独成一个带 hash 的分片（Report-<hash>.js）。
 * 一次新部署会把所有 hash 换掉，而 Vercel 的生产域名只服务最新那次部署 ——
 * 旧 hash 的文件直接 404。于是任何在部署前就打开着的页面，
 * 一旦再去跳一个还没加载过的路由，动态 import 就会失败。
 *
 * PWA 让这件事更容易发生而不是更少：`registerType: 'autoUpdate'` 生成的
 * Service Worker 带 skipWaiting + clientsClaim，新 SW 会**立刻接管已经打开的标签页**。
 * 那些标签页跑的还是旧 JS，预缓存却已经换成新资源 —— 旧分片既不在缓存里、
 * 又不在网上，必然失败。
 *
 * ── 处理 ──────────────────────────────────────────────
 * 这类错误不需要用户理解，重新加载一次就好 —— 新的 index.html 会带来新的 hash。
 * 所以：拦下 Vite 的 `vite:preloadError`，自动重载一次。
 *
 * ⚠️ 必须防重载循环：如果重载之后**仍然**失败（比如真的断网、或资源确实缺失），
 * 再自动刷就会变成无限刷新。因此用 sessionStorage 记一次时间戳，
 * 短时间内只自动重载一次，第二次改为交给 errorElement 显示可操作的提示。
 */

import type { ReactNode } from 'react'
import { useRouteError } from 'react-router'

/** 自动重载的冷却期：这段时间内只允许自动重载一次 */
const RELOAD_COOLDOWN_MS = 30_000
const RELOAD_MARK = 'xf:stale-chunk-reloaded-at'

/**
 * 是否是「分片加载失败」这一类错误。
 *
 * 纯函数，不碰 DOM —— 各浏览器的文案不一样，这里按几种已知形态匹配：
 *   Chrome/Edge  Failed to fetch dynamically imported module: …
 *   Firefox      error loading dynamically imported module: …
 *   Safari       Importing a module script failed.
 *   webpack 系   ChunkLoadError（本项目用 Vite，留着以防打包器更换）
 */
export function isStaleChunkError(error: unknown): boolean {
  if (!error) return false
  const name = (error as { name?: unknown }).name
  if (typeof name === 'string' && name === 'ChunkLoadError') return true

  const message =
    typeof error === 'string'
      ? error
      : typeof (error as { message?: unknown }).message === 'string'
        ? ((error as { message: string }).message)
        : ''
  if (!message) return false

  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /dynamically imported module/i.test(message)
  )
}

/**
 * 距上次自动重载是否已过冷却期。
 * 传入 now 与 storage 便于测试，运行时用默认值。
 */
export function shouldAutoReload(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: number = Date.now(),
): boolean {
  const raw = storage.getItem(RELOAD_MARK)
  const last = raw ? Number(raw) : NaN
  if (Number.isFinite(last) && now - last < RELOAD_COOLDOWN_MS) return false
  storage.setItem(RELOAD_MARK, String(now))
  return true
}

/**
 * 装上监听。在 main.tsx 里调用一次。
 *
 * `vite:preloadError` 是 Vite 在动态 import 的预加载失败时派发的事件；
 * preventDefault 之后 Vite 不再把它当未处理错误抛出，由我们接管。
 */
export function installStaleChunkReload(): void {
  if (typeof window === 'undefined') return

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    if (shouldAutoReload(window.sessionStorage)) window.location.reload()
  })

  // 兜底：不经 Vite 预加载路径的动态 import 失败（例如 React.lazy 直接触发的）
  window.addEventListener('unhandledrejection', (event) => {
    if (!isStaleChunkError(event.reason)) return
    event.preventDefault()
    if (shouldAutoReload(window.sessionStorage)) window.location.reload()
  })
}

/**
 * 路由级兜底界面。
 *
 * 自动重载已经用掉（冷却期内），或错误根本不是分片问题时走到这里 ——
 * 总之要给用户一个能动的东西，而不是 React Router 默认那句
 * 「Unexpected Application Error!」加一段堆栈。
 */
export function RouteError(): ReactNode {
  const error = useRouteError()
  const stale = isStaleChunkError(error)

  return (
    <div className="card m-4 p-6 text-center">
      <h1 className="font-title mb-2 text-base tracking-[0.1em]">
        {stale ? '应用已更新' : '出了点问题'}
      </h1>
      <p className="mb-5 text-sm text-subtle">
        {stale
          ? '这个页面还在用上一版的资源。重新加载一次就好，你的历史记录都存在本机，不会丢。'
          : '这一步没能完成。重新加载通常能解决；若反复出现，可以在「设置」里清除本地数据后再试。'}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded px-4 py-2 text-sm"
        style={{ background: 'var(--ink)', color: 'var(--paper)' }}
      >
        重新加载
      </button>
    </div>
  )
}
