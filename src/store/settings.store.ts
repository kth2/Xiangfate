/**
 * 应用设置。BYO Key 模式：用户填自己的 Key，只存本机 localStorage。
 * ⚠️ Key 会随请求发往 AI 服务商，这是 BYO Key 的固有性质，设置页必须写明。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_BASE_URL, type ProviderId } from '@/ai/models'

export type { ProviderId }
export type ThemeMode = 'dark' | 'light' | 'system'

export interface ProviderConfig {
  apiKey: string
  model: string
  /** 端点覆盖。留空用默认 —— 自建代理或镜像时才需要改 */
  baseUrl: string
}

export const PROVIDER_PRESETS: Record<
  ProviderId,
  { name: string; defaultModel: string; keyUrl: string; note: string; needsKeyToList: boolean }
> = {
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: '有免费额度，中文表现好，延迟低。推荐首选。',
    // Gemini 的模型列表接口要带 Key
    needsKeyToList: true,
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'deepseek/deepseek-chat-v3.1:free',
    keyUrl: 'https://openrouter.ai/keys',
    note: '聚合多家模型，带 :free 后缀的可免费使用（有速率限制）。',
    // OpenRouter 的模型列表是公开的，不填 Key 也能看
    needsKeyToList: false,
  },
}

interface SettingsState {
  /** 首启免责声明是否已确认 */
  disclaimerAccepted: boolean
  acceptDisclaimer: () => void

  provider: ProviderId
  setProvider: (p: ProviderId) => void

  configs: Record<ProviderId, ProviderConfig>
  setApiKey: (p: ProviderId, key: string) => void
  setModel: (p: ProviderId, model: string) => void
  setBaseUrl: (p: ProviderId, url: string) => void

  theme: ThemeMode
  setTheme: (t: ThemeMode) => void

  /** 用户默认的关注方向，拍摄时预填 */
  defaultFocusTopics: string[]
  setDefaultFocusTopics: (t: string[]) => void

  reset: () => void
}

const initialConfigs: Record<ProviderId, ProviderConfig> = {
  gemini: { apiKey: '', model: PROVIDER_PRESETS.gemini.defaultModel, baseUrl: '' },
  openrouter: { apiKey: '', model: PROVIDER_PRESETS.openrouter.defaultModel, baseUrl: '' },
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      disclaimerAccepted: false,
      acceptDisclaimer: () => set({ disclaimerAccepted: true }),

      provider: 'gemini',
      setProvider: (provider) => set({ provider }),

      configs: initialConfigs,
      setApiKey: (p, apiKey) =>
        set((s) => ({ configs: { ...s.configs, [p]: { ...s.configs[p], apiKey } } })),
      setModel: (p, model) =>
        set((s) => ({ configs: { ...s.configs, [p]: { ...s.configs[p], model } } })),
      setBaseUrl: (p, baseUrl) =>
        set((s) => ({ configs: { ...s.configs, [p]: { ...s.configs[p], baseUrl } } })),

      theme: 'dark',
      setTheme: (theme) => set({ theme }),

      defaultFocusTopics: [],
      setDefaultFocusTopics: (defaultFocusTopics) => set({ defaultFocusTopics }),

      reset: () =>
        set({
          provider: 'gemini',
          configs: initialConfigs,
          theme: 'dark',
          defaultFocusTopics: [],
        }),
    }),
    {
      name: 'xiangfate.settings',
      version: 2,
      /** v1 的 config 里没有 baseUrl，补上默认值，避免老用户读到 undefined */
      migrate: (persisted, version) => {
        const s = persisted as { configs?: Record<string, Partial<ProviderConfig>> }
        if (version < 2 && s?.configs) {
          for (const key of Object.keys(s.configs)) {
            s.configs[key] = { baseUrl: '', ...s.configs[key] } as ProviderConfig
          }
        }
        return s as unknown as SettingsState
      },
    },
  ),
)

/** 当前 provider 是否已配置好可用的 Key */
export function useIsConfigured(): boolean {
  return useSettings((s) => s.configs[s.provider].apiKey.trim().length > 0)
}

/** 解析出实际使用的端点 */
export function resolveBaseUrl(p: ProviderId, cfg: ProviderConfig): string {
  return cfg.baseUrl.trim() || DEFAULT_BASE_URL[p]
}
