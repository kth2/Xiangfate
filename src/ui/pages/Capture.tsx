import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getTypeSpec, isAnalysisType, type ShotSpec } from '@/core/registry'
import { captureVideoFrame, loadImageFile } from '@/core/image'
import { formatMb, totalBytes } from '@/mediapipe/loader'
import { detect, eulerFromMatrix, NoSubjectError, type DetectResult } from '@/mediapipe/detect'
import { buildMianxiangEnvelope } from '@/modules/mianxiang/pipeline'
import { useAnalysis } from '@/store/analysis.store'
import { CAPTURE_PRIVACY } from '@/copy/disclaimer.zh-CN'
import {
  HAND_CONNECTIONS,
  LandmarkOverlay,
  POSE_CONNECTIONS,
} from '../components/LandmarkOverlay'

type Stage = 'intro' | 'pick' | 'loading' | 'detecting' | 'result' | 'building'

export function Capture() {
  const { type } = useParams()
  const navigate = useNavigate()
  const spec = isAnalysisType(type ?? '') ? getTypeSpec(type!) : undefined

  const shots = useAnalysis((s) => s.shots)
  const addShot = useAnalysis((s) => s.addShot)
  const start = useAnalysis((s) => s.start)
  const setEnvelope = useAnalysis((s) => s.setEnvelope)
  const subject = useAnalysis((s) => s.subject)
  const releaseBitmaps = useAnalysis((s) => s.releaseBitmaps)

  const [stage, setStage] = useState<Stage>(spec?.caveat ? 'intro' : 'pick')
  const [shotIndex, setShotIndex] = useState(0)
  const [progress, setProgress] = useState<{ ratio: number | null; phase: string } | null>(null)
  const [result, setResult] = useState<DetectResult | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const currentShot: ShotSpec | undefined = spec?.shots[shotIndex]

  // 直接输入 URL 进来时，store 里还没有 type
  useEffect(() => {
    if (spec) start(spec.type)
    // start 会 reset，只在类型变化时跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.type])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  if (!spec) {
    return (
      <div className="page px-6 pt-16">
        <p className="text-muted">没有这种相术类型。</p>
        <Link to="/" className="btn-outline mt-6 h-11 w-full">
          回首页
        </Link>
      </div>
    )
  }

  async function openCamera() {
    setError(null)
    try {
      const facing = spec!.type === 'tixiang' ? 'environment' : 'user'
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOn(true)
      // 等 video 元素挂载
      queueMicrotask(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
    } catch {
      setError('没有相机权限也可以，从相册选一张就行')
    }
  }

  async function runDetection(bitmap: ImageBitmap, previewUrl: string, width: number, height: number) {
    const shot = currentShot!
    setPreview(previewUrl)
    setStage('loading')
    setProgress({ ratio: 0, phase: 'wasm' })
    setError(null)

    try {
      const res = await detect(shot.detector, bitmap, (p) =>
        setProgress({ ratio: p.ratio, phase: p.phase }),
      )
      setStage('detecting')
      setResult(res)
      addShot({ kind: shot.kind, bitmap, previewUrl, width, height })
      setStage('result')
    } catch (e) {
      bitmap.close()
      URL.revokeObjectURL(previewUrl)
      setPreview(null)
      setStage('pick')
      setError(
        e instanceof NoSubjectError
          ? e.message
          : e instanceof Error
            ? e.message
            : '出了点问题，再试一次',
      )
    } finally {
      setProgress(null)
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const img = await loadImageFile(file)
      await runDetection(img.bitmap, img.previewUrl, img.width, img.height)
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片读不出来')
    }
  }

  async function onShutter() {
    if (!videoRef.current) return
    try {
      const img = await captureVideoFrame(videoRef.current)
      stopCamera()
      await runDetection(img.bitmap, img.previewUrl, img.width, img.height)
    } catch (err) {
      setError(err instanceof Error ? err.message : '拍摄失败')
    }
  }

  function nextShot() {
    const next = shotIndex + 1
    if (next < spec!.shots.length) {
      setResult(null)
      setPreview(null)
      setShotIndex(next)
      setStage('pick')
      return
    }
    finish()
  }

  function skipOptional() {
    finish()
  }

  /**
   * 收尾：把关键点 + 图像跑成 AnalysisEnvelope。
   * 目前只有面相接了完整管线；其余三类到第三步后续再接。
   */
  function finish() {
    const shot = useAnalysis.getState().shots[0]
    if (spec!.type !== 'mianxiang' || !shot || !result) {
      void navigate('/report')
      return
    }
    setStage('building')
    try {
      const env = buildMianxiangEnvelope({
        detection: result,
        bitmap: shot.bitmap,
        subject,
      })
      setEnvelope(env)
      // 位图使命已尽，立刻释放 —— 它绝不进入任何持久化
      releaseBitmaps()
      void navigate('/report')
    } catch (e) {
      setStage('result')
      setError(e instanceof Error ? e.message : '特征计算失败，换一张照片试试')
    }
  }

  function retake() {
    setResult(null)
    setPreview(null)
    setStage('pick')
  }

  const pose = useMemo(
    () => (result?.transformMatrix ? eulerFromMatrix(result.transformMatrix) : null),
    [result],
  )

  const connections =
    currentShot?.detector === 'hand'
      ? HAND_CONNECTIONS
      : currentShot?.detector === 'pose'
        ? POSE_CONNECTIONS
        : undefined

  /* ---------------- 说明页（仅骨相/手相这类有局限的类型） ---------------- */
  if (stage === 'intro' && spec.caveat) {
    return (
      <div className="page flex flex-col px-6 pt-8 pb-10">
        <Header name={spec.name} onBack={() => navigate('/')} />
        <div className="rule-gold my-6" />
        <h2 className="font-title mb-5 text-lg leading-relaxed">开始之前，先说清楚</h2>
        <p className="mb-6 text-sm leading-loose text-muted">{spec.caveat}</p>

        <div className="card p-4">
          <p className="mb-3 text-[13px]">需要 {spec.shots.filter((s) => s.required).length} 张照片</p>
          <ul className="flex flex-col gap-2">
            {spec.shots.map((s) => (
              <li key={s.kind} className="flex items-center gap-2 text-[13px] text-muted">
                <span
                  aria-hidden
                  className="h-1 w-1 rounded-full"
                  style={{ background: spec.accent }}
                />
                {s.title}
                {!s.required && <span className="text-subtle">（可选）</span>}
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          onClick={() => setStage('pick')}
          className="btn-seal mt-auto h-12 w-full text-[15px]"
        >
          明白了，开始拍
        </button>
      </div>
    )
  }

  /* ---------------- 结果页 ---------------- */
  if (stage === 'result' && result && preview) {
    const points = result.landmarks.map((p) => ({ x: p.x, y: p.y }))
    return (
      <div className="page flex flex-col px-6 pt-8 pb-10">
        <Header name={spec.name} onBack={retake} backLabel="重拍" />
        <div className="rule-gold my-6" />

        <div className="card relative mb-5 overflow-hidden">
          <img src={preview} alt="" className="block w-full" />
          <LandmarkOverlay points={points} detector={currentShot!.detector} connections={connections} />
        </div>

        <div className="card mb-5 p-4">
          <p className="mb-3 flex items-center gap-2 text-[13px]">
            <span aria-hidden className="text-[var(--color-gold-400)]">✓</span>
            识别到 {result.landmarks.length} 个关键点
          </p>
          <dl className="flex flex-col gap-1.5 text-[12px] text-subtle">
            {pose && (
              <div className="flex justify-between">
                <dt>头部姿态</dt>
                <dd>
                  偏转 {pose.yaw}° · 俯仰 {pose.pitch}° · 侧倾 {pose.roll}°
                </dd>
              </div>
            )}
            {result.handedness && (
              <div className="flex justify-between">
                <dt>手别</dt>
                <dd>
                  {result.handedness.label === 'Left' ? '左手' : '右手'}（
                  {Math.round(result.handedness.score * 100)}%）
                </dd>
              </div>
            )}
            {result.worldLandmarks && (
              <div className="flex justify-between">
                <dt>世界坐标</dt>
                <dd>已获取（米制，比例与拍摄距离无关）</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt>检测置信度</dt>
              <dd>{Math.round(result.detectorScore * 100)}%</dd>
            </div>
          </dl>
        </div>

        {error && (
          <p
            className="mb-5 border-l-2 py-2 pl-3 text-[13px] leading-relaxed"
            style={{ borderColor: 'var(--color-cinnabar-500)' }}
          >
            {error}
          </p>
        )}

        {spec.type !== 'mianxiang' && (
          <p className="mb-6 text-[12px] leading-relaxed text-subtle">
            {spec.name}的特征计算尚在接入中。当前版本已跑通「拍照 → 端侧检测 → 关键点可视化」。
          </p>
        )}

        <div className="mt-auto flex gap-3">
          <button type="button" onClick={retake} className="btn-outline h-12 flex-1 text-[15px]">
            重拍
          </button>
          <button type="button" onClick={nextShot} className="btn-seal h-12 flex-[2] text-[15px]">
            {shotIndex + 1 < spec.shots.length ? '下一张' : '下一步'}
          </button>
        </div>
      </div>
    )
  }

  /* ---------------- 加载 / 检测中 ---------------- */
  if (stage === 'loading' || stage === 'detecting' || stage === 'building') {
    const phaseLabel =
      stage === 'building'
        ? '正在计算特征'
        : progress?.phase === 'wasm'
        ? '正在准备检测引擎'
        : progress?.phase === 'model'
          ? '正在下载模型'
          : progress?.phase === 'init'
            ? '正在初始化'
            : '正在识别关键点'
    const pct = progress?.ratio != null ? Math.round(progress.ratio * 100) : null

    return (
      <div className="page flex flex-col items-center justify-center gap-6 px-10">
        <div className="h-px w-full max-w-xs overflow-hidden bg-[var(--line)]">
          <div
            className="h-full transition-[width] duration-200"
            style={{
              width: pct != null ? `${pct}%` : '35%',
              background: 'var(--color-gold-400)',
            }}
          />
        </div>
        <p className="font-title text-sm tracking-[0.25em]">{phaseLabel}</p>
        <p className="text-center text-[12px] leading-relaxed text-subtle">
          {progress?.phase === 'model'
            ? `模型约 ${formatMb(totalBytes([currentShot!.detector]))}，只需下载一次`
            : '全部在你的设备上完成'}
        </p>
      </div>
    )
  }

  /* ---------------- 拍摄 / 上传 ---------------- */
  return (
    <div className="page flex flex-col px-6 pt-8 pb-10">
      <Header
        name={spec.name}
        onBack={() => (cameraOn ? stopCamera() : navigate('/'))}
        step={spec.shots.length > 1 ? `${shotIndex + 1}/${spec.shots.length}` : undefined}
      />
      <div className="rule-gold my-6" />

      <h2 className="font-title mb-4 text-lg tracking-[0.1em]">{currentShot!.title}</h2>

      <ul className="mb-6 flex flex-col gap-2.5">
        {currentShot!.tips.map((t) => (
          <li key={t} className="flex gap-2.5 text-[13px] leading-relaxed text-muted">
            <span
              aria-hidden
              className="mt-[0.5rem] h-1 w-1 shrink-0 rounded-full"
              style={{ background: spec.accent }}
            />
            {t}
          </li>
        ))}
      </ul>

      {cameraOn && (
        <div className="card relative mb-5 overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="block w-full"
            style={{ transform: spec.type === 'tixiang' ? 'none' : 'scaleX(-1)' }}
          />
        </div>
      )}

      {error && (
        <p
          className="mb-5 border-l-2 py-2 pl-3 text-[13px] leading-relaxed"
          style={{ borderColor: 'var(--color-cinnabar-500)' }}
        >
          {error}
        </p>
      )}

      <p className="mb-6 text-[12px] leading-relaxed text-subtle">{CAPTURE_PRIVACY}</p>

      <div className="mt-auto flex flex-col gap-3">
        {cameraOn ? (
          <button type="button" onClick={onShutter} className="btn-seal h-12 w-full text-[15px]">
            拍摄
          </button>
        ) : (
          <button type="button" onClick={openCamera} className="btn-seal h-12 w-full text-[15px]">
            打开相机
          </button>
        )}

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="btn-outline h-12 w-full text-[15px]"
        >
          从相册选择
        </button>

        {!currentShot!.required && (
          <button
            type="button"
            onClick={skipOptional}
            className="py-2 text-[13px] text-subtle underline-offset-4"
          >
            跳过这张
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
      </div>

      {shots.length > 0 && (
        <p className="mt-4 text-center text-[12px] text-subtle">已采集 {shots.length} 张</p>
      )}
    </div>
  )
}

function Header({
  name,
  onBack,
  backLabel = '返回',
  step,
}: {
  name: string
  onBack: () => void
  backLabel?: string
  step?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <button type="button" onClick={onBack} className="font-title text-[13px] tracking-[0.1em] text-muted">
        ← {backLabel}
      </button>
      <h1 className="font-title text-base tracking-[0.25em]">{name}</h1>
      <span className="w-12 text-right text-[12px] text-subtle">{step ?? ''}</span>
    </div>
  )
}
