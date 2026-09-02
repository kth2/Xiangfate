/**
 * 开发用验证台：/dev/validate
 *
 * 选一批照片 → 跑真实的检测管线 → 就地出 Phase 0 / Phase 1 对比表。
 *
 * 为什么做成页面而不是 node 脚本：
 *   · MediaPipe 在 node 里要 canvas polyfill，又脆又重
 *   · **照片不必离开你的设备** —— 这条是本项目的硬承诺，验证工具也不能破例
 *   · 跑的是与生产完全相同的代码路径，不存在「测试环境和线上不一样」
 *
 * 导出的 JSON **只含关键点与画质分，不含任何图像**，
 * 可以存成回归夹具，日后改阈值时重跑同一批样本。
 *
 * 未在任何界面里链接，也不进主包（路由里 lazy 引入）。
 */

import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { loadImageFile } from '@/core/image'
import { detect } from '@/mediapipe/detect'
import {
  buildReport,
  EXPORT_VERSION,
  formatReport,
  type ExportBundle,
  type LandmarkSample,
} from '@/dev/validate'
import {
  formatPalmReport,
  PALM_EXPORT_VERSION,
  type PalmBundle,
  type PalmSample,
} from '@/dev/palm-validate'
import { analyzePalm } from '@/modules/shouxiang/pipeline'
import { computeMounts } from '@/modules/shouxiang/mounts'

/** 文件名形如 `张三_01.jpg` / `张三-正面-2.jpg` 时，下划线或短横前的部分视作同一个人 */
/* 手相定标：与人脸走两条独立的收集线，报告也各出一份 */
const HAND_SIDE = (name: string): 'left' | 'right' =>
  /left|左/i.test(name) ? 'left' : 'right'

function subjectOf(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '')
  const m = base.split(/[_\-\s]/)[0]
  return m || base
}

export function DevValidate() {
  const [samples, setSamples] = useState<LandmarkSample[]>([])
  const [palms, setPalms] = useState<PalmSample[]>([])
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [report, setReport] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const palmRef = useRef<HTMLInputElement>(null)

  const say = (s: string) => setLog((l) => [...l, s])

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return

    setBusy(true)
    setReport(null)
    const next: LandmarkSample[] = []

    for (const f of files) {
      try {
        const img = await loadImageFile(f)
        const res = await detect('face', img.bitmap)
        next.push({
          shotId: f.name,
          subjectId: subjectOf(f.name),
          label: f.name,
          landmarks: res.landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
          imgWidth: img.width,
          imgHeight: img.height,
          transformMatrix: res.transformMatrix,
          qualityScore: res.detectorScore,
        })
        say(`✓ ${f.name}`)
        img.bitmap.close()
        URL.revokeObjectURL(img.previewUrl)
      } catch (err) {
        say(`✗ ${f.name} —— ${err instanceof Error ? err.message : '检测失败'}`)
      }
    }

    setSamples((s) => [...s, ...next])
    setBusy(false)
  }

  /**
   * 手掌那条线。
   *
   * 跑的是与生产完全相同的路径（detect → analyzePalm → computeMounts），
   * 所以导出的数字就是线上会拿到的数字 —— 定标才有意义。
   * 同样一个像素都不导出。
   */
  async function onPalmFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!files.length) return

    setBusy(true)
    setReport(null)
    const next: PalmSample[] = []

    for (const f of files) {
      try {
        const img = await loadImageFile(f)
        const res = await detect('hand', img.bitmap)
        const side = HAND_SIDE(f.name)
        const analysis = await analyzePalm({ detection: res, bitmap: img.bitmap, side })
        const { mounts, palmMedianLuma } = computeMounts(analysis.normalized)

        const lines: PalmSample['lines'] = {}
        for (const [name, m] of analysis.lines) {
          // 折线本身可反推掌形，不导出；只留度量
          const { points: _drop, name: _n, ...rest } = m
          lines[name] = rest
        }

        next.push({
          subjectId: subjectOf(f.name),
          label: f.name,
          side,
          handedness: res.handedness?.label ?? (side === 'left' ? 'Left' : 'Right'),
          landmarks: res.landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
          imgWidth: img.width,
          imgHeight: img.height,
          detectorScore: res.detectorScore,
          lines,
          mounts: Object.fromEntries(
            Object.entries(mounts).map(([k, v]) => [
              k,
              {
                sampleCount: v.sampleCount,
                medianLuma: v.medianLuma,
                fullness: v.fullness,
                band: v.band,
              },
            ]),
          ),
          palmMedianLuma,
        })
        say(`✓ ${f.name} —— 归类出 ${Object.keys(lines).length} 条主线`)
        img.bitmap.close()
        URL.revokeObjectURL(img.previewUrl)
      } catch (err) {
        say(`✗ ${f.name} —— ${err instanceof Error ? err.message : '检测失败'}`)
      }
    }

    setPalms((s) => [...s, ...next])
    setBusy(false)
  }

  function palmBundle(): PalmBundle {
    return {
      version: PALM_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      samples: palms,
    }
  }

  function runPalm() {
    try {
      setReport(formatPalmReport(palmBundle()))
    } catch (err) {
      say(`✗ 生成手相报告失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function bundle(): ExportBundle {
    return { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), samples }
  }

  function run() {
    try {
      setReport(formatReport(buildReport(bundle())))
    } catch (err) {
      say(`✗ 生成报告失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function download(name: string, text: string, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const subjects = new Set(samples.map((s) => s.subjectId)).size

  return (
    <div className="page px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-title text-[13px] tracking-[0.1em] text-muted">
          ← 首页
        </Link>
        <h1 className="font-title text-base tracking-[0.25em]">验证台</h1>
        <span className="w-12" />
      </div>

      <p className="mt-5 border-l-2 py-2 pl-3 text-[12px] leading-relaxed text-muted"
         style={{ borderColor: 'var(--color-gold-400)' }}>
        开发工具。照片只在本机处理，导出的 JSON 只含关键点，不含任何图像。
        文件名下划线前的部分会被当作同一个人（如 <code>张三_01.jpg</code>），
        用来算跨拍摄一致性。
      </p>

      <div className="rule-gold my-6" />

      <div className="flex flex-col gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFiles}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="btn-seal h-12 text-[15px]"
        >
          {busy ? '检测中…' : '选照片（可多选）'}
        </button>

        <p className="text-[12px] text-muted">
          已收 {samples.length} 张，来自 {subjects} 位
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={!samples.length}
            onClick={run}
            className="btn-outline h-11 flex-1 text-[14px] disabled:opacity-40"
          >
            出报告
          </button>
          <button
            type="button"
            disabled={!samples.length}
            onClick={() => download('landmarks.json', JSON.stringify(bundle()))}
            className="btn-outline h-11 flex-1 text-[14px] disabled:opacity-40"
          >
            导出关键点
          </button>
          <button
            type="button"
            disabled={!samples.length}
            onClick={() => {
              setSamples([])
              setLog([])
              setReport(null)
            }}
            className="btn-outline h-11 px-4 text-[14px] disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>

      <div className="rule-gold my-6" />

      {/* ---- 手相定标：与人脸分开，两批样本互不相干 ---- */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-title text-sm tracking-[0.2em]">手相定标</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            收手掌照，导出三件目前只能靠猜的东西：归一化的病态程度、掌纹响应的分布、
            掌丘取样圆压在什么上。文件名含 left / 左 者按左手处理。
          </p>
        </div>

        <input
          ref={palmRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onPalmFiles}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => palmRef.current?.click()}
          className="btn-outline h-12 text-[15px] disabled:opacity-40"
        >
          {busy ? '检测中…' : '选手掌照（可多选）'}
        </button>

        <p className="text-[12px] text-muted">
          已收 {palms.length} 只手，来自 {new Set(palms.map((p) => p.subjectId)).size} 位
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            disabled={!palms.length}
            onClick={runPalm}
            className="btn-outline h-11 flex-1 text-[14px] disabled:opacity-40"
          >
            出定标报告
          </button>
          <button
            type="button"
            disabled={!palms.length}
            onClick={() => download('palm-calibration.json', JSON.stringify(palmBundle()))}
            className="btn-outline h-11 flex-1 text-[14px] disabled:opacity-40"
          >
            导出手掌数据
          </button>
          <button
            type="button"
            disabled={!palms.length}
            onClick={() => {
              setPalms([])
              setReport(null)
            }}
            className="btn-outline h-11 px-4 text-[14px] disabled:opacity-40"
          >
            清空
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <section className="card mt-6 p-4">
          <h2 className="font-title mb-2 text-sm tracking-[0.2em]">日志</h2>
          <pre className="overflow-x-auto text-[11px] leading-relaxed text-muted">{log.join('\n')}</pre>
        </section>
      )}

      {report && (
        <section className="card mt-6 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-title text-sm tracking-[0.2em]">报告</h2>
            <button
              type="button"
              onClick={() => download('validation.md', report, 'text/markdown')}
              className="text-[11px] text-subtle underline"
            >
              下载 Markdown
            </button>
          </div>
          <pre className="overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap">{report}</pre>
        </section>
      )}
    </div>
  )
}
