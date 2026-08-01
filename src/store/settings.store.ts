/**
 * 应用设置。BYO Key 模式：用户填自己的 Key，只存本机 localStorage。
 * ⚠️ Key 会随请求发往 AI 服务商，这是 BYO Key 的固有性质，设置页必须写明。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ProviderId = 'gemini' | 'openrouter'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface ProviderConfig {
  apiKey: string
  model: string
}

export const PROVIDER_PRESETS: Record<
  ProviderId,
  { name: string; defaultModel: string; models: string[]; keyUrl: string; note: string }
> = {
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
    keyUrl: 'https://aistudio.google.com/apikey',
    note: '有免费额度，中文表现好，延迟低。推荐首选。',
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'deepseek/deepseek-chat-v3.1:free',
    models: [
      'deepseek/deepseek-chat-v3.1:free',
      'qwen/qwen3-235b-a22b:free',
      'google/gemini-2.5-flash',
    ],
    keyUrl: 'https://openrouter.ai/keys',
    note: '聚合多家模型，带 :free 后缀的可免费使用（有速率限制）。',
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

  theme: ThemeMode
  setTheme: (t: ThemeMode) => void

  /** 用户默认的关注方向，拍摄时预填 */
  defaultFocusTopics: string[]
  setDefaultFocusTopics: (t: string[]) => void

  reset: () => void
}

const initialConfigs: Record<ProviderId, ProviderConfig> = {
  gemini: { apiKey: '', model: PROVIDER_PRESETS.gemini.defaultModel },
  openrouter: { apiKey: '', model: PROVIDER_PRESETS.openrouter.defaultModel },
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
      version: 1,
    },
  ),
)

/** 当前 provider 是否已配置好可用的 Key */
export function useIsConfigured(): boolean {
  return useSettings((s) => s.configs[s.provider].apiKey.trim().length > 0)
}
