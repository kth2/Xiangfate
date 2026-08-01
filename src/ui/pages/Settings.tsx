import { useState } from 'react'
import { Link } from 'react-router'
import {
  PROVIDER_PRESETS,
  useSettings,
  type ProviderId,
  type ThemeMode,
} from '@/store/settings.store'
import { releaseAll } from '@/mediapipe/loader'

export function Settings() {
  const {
    provider,
    setProvider,
    configs,
    setApiKey,
    setModel,
    theme,
    setTheme,
  } = useSettings()
  const [revealed, setRevealed] = useState(false)
  const [cleared, setCleared] = useState(false)

  const preset = PROVIDER_PRESETS[provider]
  const config = configs[provider]

  async function clearEverything() {
    if (!confirm('清除所有历史记录与已缓存的模型？此操作不可撤销。')) return
    releaseAll()
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    }
    if ('indexedDB' in window) {
      indexedDB.deleteDatabase('xiangfate')
    }
    setCleared(true)
  }

  return (
    <div className="page px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-title text-[13px] tracking-[0.1em] text-muted">
          ← 返回
        </Link>
        <h1 className="font-title text-base tracking-[0.25em]">设置</h1>
        <span className="w-12" />
      </div>

      <div className="rule-gold my-6" />

      {/* ---- AI 接口 ---- */}
      <section className="mb-10">
        <h2 className="font-title mb-1 text-sm tracking-[0.15em]">AI 接口</h2>
        <p className="mb-4 text-[12px] leading-relaxed text-subtle">
          特征提取不需要联网，但生成解读文字需要一个 AI 接口。填你自己的 Key，
          它只存在这台设备的浏览器里。
        </p>

        <div className="mb-4 flex gap-2">
          {(Object.keys(PROVIDER_PRESETS) as ProviderId[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className="flex-1 border py-2.5 text-[13px] transition-colors"
              style={{
                borderColor: p === provider ? 'var(--color-gold-400)' : 'var(--line)',
                color: p === provider ? 'var(--fg-base)' : 'var(--fg-subtle)',
                borderRadius: 2,
              }}
            >
              {PROVIDER_PRESETS[p].name}
            </button>
          ))}
        </div>

        <p className="mb-4 text-[12px] leading-relaxed text-muted">{preset.note}</p>

        <label className="mb-2 block text-[13px]">API Key</label>
        <div className="mb-2 flex gap-2">
          <input
            type={revealed ? 'text' : 'password'}
            value={config.apiKey}
            onChange={(e) => setApiKey(provider, e.target.value)}
            placeholder="粘贴你的 API Key"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 border bg-transparent px-3 py-2.5 font-mono text-[13px] outline-none"
            style={{ borderColor: 'var(--line)', borderRadius: 2 }}
          />
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="btn-outline shrink-0 px-3 text-[12px]"
          >
            {revealed ? '隐藏' : '显示'}
          </button>
        </div>
        <a
          href={preset.keyUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mb-5 inline-block text-[12px] text-[var(--color-gold-400)] underline-offset-4"
        >
          去 {preset.name} 申请 Key →
        </a>

        <label className="mb-2 block text-[13px]">模型</label>
        <select
          value={config.model}
          onChange={(e) => setModel(provider, e.target.value)}
          className="w-full border bg-transparent px-3 py-2.5 text-[13px] outline-none"
          style={{ borderColor: 'var(--line)', borderRadius: 2 }}
        >
          {preset.models.map((m) => (
            <option key={m} value={m} className="bg-[var(--bg-raised)]">
              {m}
            </option>
          ))}
        </select>

        <div
          className="mt-4 border-l-2 py-2 pl-3"
          style={{ borderColor: 'var(--color-cinnabar-500)' }}
        >
          <p className="text-[12px] leading-relaxed text-muted">
            这是 BYO Key 模式：Key 存在你的浏览器里，请求直接从你的设备发往服务商。
            不要在公用设备上填写。如果你要把这个应用公开部署给别人用，
            请改用代理模式（见 README）。
          </p>
        </div>
      </section>

      {/* ---- 外观 ---- */}
      <section className="mb-10">
        <h2 className="font-title mb-4 text-sm tracking-[0.15em]">外观</h2>
        <div className="flex gap-2">
          {(
            [
              ['dark', '墨色'],
              ['light', '宣纸'],
              ['system', '跟随系统'],
            ] as [ThemeMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setTheme(mode)}
              className="flex-1 border py-2.5 text-[13px] transition-colors"
              style={{
                borderColor: mode === theme ? 'var(--color-gold-400)' : 'var(--line)',
                color: mode === theme ? 'var(--fg-base)' : 'var(--fg-subtle)',
                borderRadius: 2,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* ---- 数据 ---- */}
      <section>
        <h2 className="font-title mb-1 text-sm tracking-[0.15em]">数据</h2>
        <p className="mb-4 text-[12px] leading-relaxed text-subtle">
          历史记录存在本地 IndexedDB，从不上传。照片从来没有被保存过。
        </p>
        <button
          type="button"
          onClick={() => void clearEverything()}
          className="btn-outline h-11 w-full text-[14px]"
          style={{ borderColor: 'var(--color-cinnabar-500)' }}
        >
          清除历史记录与模型缓存
        </button>
        {cleared && <p className="mt-3 text-center text-[12px] text-muted">已清除</p>}
      </section>
    </div>
  )
}
