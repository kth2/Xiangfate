/**
 * 当前分析会话。
 *
 * ⚠️ 隐私红线：ImageBitmap 只活在这个 store 里，且只在内存中。
 * 离开分析流程必须调 reset()，它会 close() 所有位图。
 * 绝不写入 IndexedDB / localStorage —— persist 中间件在这里是禁用的。
 */

import { create } from 'zustand'
import type { AnalysisEnvelope, AnalysisType, ShotKind, Subject } from '@/core/types'

export type Phase = 'idle' | 'capturing' | 'extracting' | 'ready' | 'generating' | 'done' | 'error'

export interface CapturedShot {
  kind: ShotKind
  bitmap: ImageBitmap
  /** 仅用于当前会话内预览，reset 时 revoke */
  previewUrl: string
  width: number
  height: number
}

interface AnalysisState {
  type: AnalysisType | null
  phase: Phase
  shots: CapturedShot[]
  subject: Subject
  envelope: AnalysisEnvelope | null
  /** AI 生成的报告正文（流式累积） */
  report: string
  error: string | null

  start: (type: AnalysisType) => void
  addShot: (shot: CapturedShot) => void
  removeShot: (kind: ShotKind) => void
  getShot: (kind: ShotKind) => CapturedShot | undefined
  setSubject: (patch: Partial<Subject>) => void
  setPhase: (phase: Phase) => void
  setEnvelope: (envelope: AnalysisEnvelope) => void
  appendReport: (chunk: string) => void
  setReport: (report: string) => void
  setError: (error: string | null) => void
  /** 特征提取完成后立即调用：位图使命已尽，尽早释放 */
  releaseBitmaps: () => void
  reset: () => void
}

function disposeShot(shot: CapturedShot) {
  try {
    shot.bitmap.close()
  } catch {
    /* 已释放 */
  }
  URL.revokeObjectURL(shot.previewUrl)
}

export const useAnalysis = create<AnalysisState>((set, get) => ({
  type: null,
  phase: 'idle',
  shots: [],
  subject: { gender: 'unspecified', isSelf: true, focusTopics: [] },
  envelope: null,
  report: '',
  error: null,

  start: (type) => {
    get().reset()
    set({ type, phase: 'capturing' })
  },

  addShot: (shot) =>
    set((s) => {
      // 同一机位重拍时，先释放旧的
      const prev = s.shots.find((x) => x.kind === shot.kind)
      if (prev) disposeShot(prev)
      return { shots: [...s.shots.filter((x) => x.kind !== shot.kind), shot] }
    }),

  removeShot: (kind) =>
    set((s) => {
      const target = s.shots.find((x) => x.kind === kind)
      if (target) disposeShot(target)
      return { shots: s.shots.filter((x) => x.kind !== kind) }
    }),

  getShot: (kind) => get().shots.find((x) => x.kind === kind),

  setSubject: (patch) => set((s) => ({ subject: { ...s.subject, ...patch } })),
  setPhase: (phase) => set({ phase }),
  setEnvelope: (envelope) => set({ envelope }),
  appendReport: (chunk) => set((s) => ({ report: s.report + chunk })),
  setReport: (report) => set({ report }),
  setError: (error) => set({ error, phase: error ? 'error' : get().phase }),

  releaseBitmaps: () =>
    set((s) => {
      s.shots.forEach(disposeShot)
      return { shots: [] }
    }),

  reset: () => {
    get().shots.forEach(disposeShot)
    set({
      type: null,
      phase: 'idle',
      shots: [],
      subject: { gender: 'unspecified', isSelf: true, focusTopics: [] },
      envelope: null,
      report: '',
      error: null,
    })
  },
}))
