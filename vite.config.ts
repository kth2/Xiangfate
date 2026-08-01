import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg'],
      manifest: {
        name: '相由 · Xiangfate',
        short_name: '相由',
        description: 'AI 传统相术分析 —— 面相 · 手相 · 骨相 · 体相。仅供娱乐与传统文化参考。',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#14120f',
        theme_color: '#14120f',
        icons: [
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icons/icon-maskable.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: '面相', url: '/capture/mianxiang' },
          { name: '手相', url: '/capture/shouxiang' },
          { name: '骨相', url: '/capture/guxiang' },
          { name: '体相', url: '/capture/tixiang' },
        ],
      },
      workbox: {
        // 只预缓存应用壳。MediaPipe 的 wasm（约 11.7MB）与 .task 模型（共约 17MB）
        // 都太大，一律改成按需的运行时缓存 —— 首屏不该为还没用到的相术类型买单
        globPatterns: ['**/*.{js,css,html,svg}'],
        globIgnores: ['mediapipe/wasm/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/mediapipe\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/storage\.googleapis\.com\/mediapipe-models\/.*\.task$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mediapipe-models',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/mediapipe/wasm/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mediapipe-wasm',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    // tasks-vision 自身约 1MB，靠 mediapipe/loader.ts 里的动态 import 自然分包，
    // 不需要 manualChunks 再切一刀
    target: 'es2022',
  },
})
