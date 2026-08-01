import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { getTypeSpec, isAnalysisType, type ShotSpec } from '@/core/registry'
import { captureVideoFrame, loadImageFile } from '@/core/image'
import { formatMb, totalBytes } from '@/mediapipe/loader'
import { detect, eulerFromMatrix, NoSubjectError, type DetectResult } from '@/mediapipe/detect'
import { buildMianxiangEnvelope } from '@/modules/mianxiang/pipeline'
import { buildTixiangEnvelope } from '@/modules/tixiang/pipeline'
import { buildGuxiangEnvelope } from '@/modules/guxiang/pipeline'
import {
  analyzePalm,
  buildShouxiangEnvelope,
  needsCorrection,
  type HandShot,
  type PalmAnalysis,
} from '@/modules/shouxiang/pipeline'
import type { SurveyAnswers } from '@/modules/tixiang/survey'
import type { P2 } from '@/core/geom'
import type { AnalysisEnvelope, PalmLineName, ShotKind } from '@/core/types'
import { useAnalysis } from '@/store/analysis.store'
import { CAPTURE_PRIVACY } from '@/copy/disclaimer.zh-CN'
import { HAND_CONNECTIONS, LandmarkOverlay, POSE_CONNECTIONS } from '../components/LandmarkOverlay'
import { PalmLineCorrector } from '../components/PalmLineCorrector'
import { BodySurvey } from '../components/BodySurvey'

type Stage =
  | 'intro'
  | 'pick'
  | 'loading'
  | 'result'
  | 'building'
  | 'survey'
  | 'correct'

/** 每个机位的采集结果，收尾时统一交给对应的 pipeline */
interface Captured {
  kind: ShotKind
  detection: DetectResult
  bitmap: ImageBitmap
  previewUrl: string
}

export function Capture() {
  const { type } = useParams()
  const navigate = useNavigate()
  const spec = isAnalysisType(type ?? '') ? getTypeSpec(type!) : undefined

  const start = useAnalysis((s) => s.start)
  const setEnvelope = useAnalysis((s) => s.setEnvelope)
  const subject = useAnalysis((s) => s.subject)

  const [stage, setStage] = useState<Stage>(spec?.caveat ? 'intro' : 'pick')
  const [shotIndex, setShotIndex] = useState(0)
  const [progress, setProgress] = useState<{ ratio: number | null; phase: string } | null>(null)
  const [result, setResult] = useState<DetectResult | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [palm, setPalm] = useState<PalmAnalysis | null>(null)
  const [palmMissing, setPalmMissing] = useState<PalmLineName[]>([])

  const capturedRef = useRef<Captured[]>([])
  const palmAnalysesRef = useRef<PalmAnalysis[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const currentShot: ShotSpec | undefined = spec?.shots[shotIndex]

  useEffect(() => {
    if (spec) start(spec.type)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.type])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  // 离开页面时释放所有位图 —— 它们绝不进入任何持久化
  useEffect(
    () => () => {
      stopCamera()
      for (const c of capturedRef.current) {
        try {
          c.bitmap.close()
        } catch {
          /* 已释放 */
        }
        URL.revokeObjectURL(c.previewUrl)
      }
      capturedRef.current = []
    },
    [stopCamera],
  )

  const pose = useMemo(
    () => (result?.transformMatrix ? eulerFromMatrix(result.transformMatrix) : null),
    [result],
  )

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

  async function runDetection(bitmap: ImageBitmap, previewUrl: string) {
    const shot = currentShot!
    setPreview(previewUrl)
    setStage('loading')
    setProgress({ ratio: 0, phase: 'wasm' })
    setError(null)

    try {
      const res = await detect(shot.detector, bitmap, (p) =>
        setProgress({ ratio: p.ratio, phase: p.phase }),
      )
      // 同一机位重拍时先释放旧的
      const prev = capturedRef.current.find((c) => c.kind === shot.kind)
      if (prev) {
        prev.bitmap.close()
        URL.revokeObjectURL(prev.previewUrl)
      }
      capturedRef.current = [
        ...capturedRef.current.filter((c) => c.kind !== shot.kind),
        { kind: shot.kind, detection: res, bitmap, previewUrl },
      ]
      setResult(res)
      setStage('result')
    } catch (e) {
      bitmap.close()
      URL.revokeObjectURL(previewUrl)
      setPreview(null)
      setStage('pick')
      setError(
        e instanceof NoSubjectError ? e.message : e instanceof Error ? e.message : '出了点问题，再试一次',
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
      await runDetection(img.bitmap, img.previewUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片读不出来')
    }
  }

  async function onShutter() {
    if (!videoRef.current) return
    try {
      const img = await captureVideoFrame(videoRef.current)
      stopCamera()
      await runDetection(img.bitmap, img.previewUrl)
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
    void finish()
  }

  /* ---------------- 收尾：分派到对应的 pipeline ---------------- */

  async function finish(survey?: SurveyAnswers | null) {
    const caps = capturedRef.current
    setStage('building')
    setError(null)

    try {
      let env: AnalysisEnvelope

      switch (spec!.type) {
        case 'mianxiang': {
          const front = caps.find((c) => c.kind === 'front')
          if (!front) throw new Error('缺少正面照')
          env = buildMianxiangEnvelope({ detection: front.detection, bitmap: front.bitmap, subject })
          break
        }

        case 'tixiang': {
          const body = caps[0]
          if (!body) throw new Error('缺少体照')
          // 先问自评，再出报告
          if (survey === undefined) {
            setStage('survey')
            return
          }
          env = buildTixiangEnvelope({
            detection: body.detection,
            bitmap: body.bitmap,
            subject,
            survey,
            shotKind: body.kind,
          })
          break
        }

        case 'guxiang': {
          const front = caps.find((c) => c.kind === 'front')
          const profile = caps.find((c) => c.kind === 'profile')
          const bodyShot = caps.find((c) => c.kind === 'half_body')
          if (!front) throw new Error('缺少正面照')
          env = buildGuxiangEnvelope({
            front: { detection: front.detection, bitmap: front.bitmap },
            profile: profile ? { detection: profile.detection, bitmap: profile.bitmap } : null,
            body: bodyShot ? { detection: bodyShot.detection, bitmap: bodyShot.bitmap } : null,
            subject,
          })
          break
        }

        case 'shouxiang': {
          const handShots: HandShot[] = caps.map((c) => ({
            detection: c.detection,
            bitmap: c.bitmap,
            side: c.kind === 'left_palm' ? 'left' : 'right',
          }))
          if (!handShots.length) throw new Error('缺少手掌照')

          // 掌纹提取跑 Worker，可能要几百毫秒
          if (!palmAnalysesRef.current.length) {
            setProgress({ ratio: null, phase: 'palm' })
            palmAnalysesRef.current = await Promise.all(handShots.map(analyzePalm))
            setProgress(null)
          }

          // 主线没测全就请用户校正 —— 宁可让用户参与，也不凭空生成掌纹判断
          const primary = palmAnalysesRef.current[0]
          const missing = needsCorrection(primary)
          if (missing.length && !palm) {
            setPalm(primary)
            setPalmMissing(missing)
            setStage('correct')
            return
          }

          env = buildShouxiangEnvelope(
            { shots: handShots, subject, dominantHand: handShots[0].side, corrections: correctionsRef.current },
            palmAnalysesRef.current,
          )
          break
        }
      }

      setEnvelope(env)
      releaseAll()
      void navigate('/report')
    } catch (e) {
      setStage('result')
      setProgress(null)
      setError(e instanceof Error ? e.message : '特征计算失败，换一张照片试试')
    }
  }

  const correctionsRef = useRef<Partial<Record<PalmLineName, P2[]>>>({})

  function releaseAll() {
    for (const c of capturedRef.current) {
      try {
        c.bitmap.close()
      } catch {
        /* 已释放 */
      }
      URL.revokeObjectURL(c.previewUrl)
    }
    capturedRef.current = []
  }

  function retake() {
    setResult(null)
    setPreview(null)
    setStage('pick')
  }

  const connections =
    currentShot?.detector === 'hand'
      ? HAND_CONNECTIONS
      : currentShot?.detector === 'pose'
        ? POSE_CONNECTIONS
        : undefined

  /* ---------------- 说明页 ---------------- */
  if (stage === 'intro' && spec.caveat) {
    return (
      <div className="page flex flex-col px-6 pt-8 pb-10">
        <Header name={spec.name} onBack={() => navigate('/')} />
        <div className="rule-gold my-6" />
        <h2 className="font-title mb-5 text-lg leading-relaxed">开始之前，先说清楚</h2>
        <p className="mb-6 text-sm leading-loose text-muted">{spec.caveat}</p>

        <div className="card p-4">
          <p className="mb-3 text-[13px]">
            需要 {spec.shots.filter((s) => s.required).length} 张照片
          </p>
          <ul className="flex flex-col gap-2">
            {spec.shots.map((s) => (
              <li key={s.kind} className="flex items-center gap-2 text-[13px] text-muted">
                <span aria-hidden className="h-1 w-1 rounded-full" style={{ background: spec.accent }} />
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

  /* ---------------- 体相自评 ---------------- */
  if (stage === 'survey') {
    return (
      <div className="page px-6 pt-8 pb-10">
        <Header name={spec.name} onBack={() => setStage('result')} backLabel="返回" />
        <div className="rule-gold my-6" />
        <BodySurvey accent={spec.accent} onDone={(a) => void finish(a)} />
      </div>
    )
  }

  /* ---------------- 掌纹校正 ---------------- */
  if (stage === 'correct' && palm) {
    return (
      <div className="page px-6 pt-8 pb-10">
        <Header name={spec.name} onBack={() => setStage('result')} backLabel="返回" />
        <div className="rule-gold my-6" />
        <PalmLineCorrector
          analysis={palm}
          missing={palmMissing}
          accent={spec.accent}
          onDone={(c) => {
            correctionsRef.current = c
            setPalm(null)
            void finish()
          }}
        />
      </div>
    )
  }

  /* ---------------- 结果页 ---------------- */
  if (stage === 'result' && result && preview) {
    const points = result.landmarks.map((p) => ({ x: p.x, y: p.y }))
    const isLast = shotIndex + 1 >= spec.shots.length
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
            <span aria-hidden style={{ color: spec.accent }}>
              ✓
            </span>
            识别到 {result.landmarks.length} 个关键点
          </p>
          <dl className="flex flex-col gap-1.5 text-[12px] text-subtle">
            {pose && (
              <Row k="头部姿态" v={`偏转 ${pose.yaw}° · 俯仰 ${pose.pitch}° · 侧倾 ${pose.roll}°`} />
            )}
            {result.handedness && (
              <Row
                k="手别"
                v={`${result.handedness.label === 'Left' ? '左手' : '右手'}（${Math.round(result.handedness.score * 100)}%）`}
              />
            )}
            {result.worldLandmarks && <Row k="世界坐标" v="已获取（米制，与拍摄距离无关）" />}
            <Row k="检测置信度" v={`${Math.round(result.detectorScore * 100)}%`} />
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

        <div className="mt-auto flex gap-3">
          <button type="button" onClick={retake} className="btn-outline h-12 flex-1 text-[15px]">
            重拍
          </button>
          <button type="button" onClick={nextShot} className="btn-seal h-12 flex-[2] text-[15px]">
            {isLast ? '出报告' : '下一张'}
          </button>
        </div>

        {!isLast && !spec.shots[shotIndex + 1].required && (
          <button
            type="button"
            onClick={() => void finish()}
            className="mt-3 py-2 text-center text-[13px] text-subtle"
          >
            跳过剩下的，直接出报告
          </button>
        )}
      </div>
    )
  }

  /* ---------------- 加载 / 计算中 ---------------- */
  if (stage === 'loading' || stage === 'building') {
    const phaseLabel =
      progress?.phase === 'palm'
        ? '正在提取掌纹'
        : stage === 'building'
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
            style={{ width: pct != null ? `${pct}%` : '35%', background: spec.accent }}
          />
        </div>
        <p className="font-title text-sm tracking-[0.25em]">{phaseLabel}</p>
        <p className="text-center text-[12px] leading-relaxed text-subtle">
          {progress?.phase === 'model'
            ? `模型约 ${formatMb(totalBytes([currentShot!.detector]))}，只需下载一次`
            : progress?.phase === 'palm'
              ? '掌纹提取在后台线程进行，稍等几秒'
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
          <button type="button" onClick={() => void onShutter()} className="btn-seal h-12 w-full text-[15px]">
            拍摄
          </button>
        ) : (
          <button type="button" onClick={() => void openCamera()} className="btn-seal h-12 w-full text-[15px]">
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
            onClick={() => void finish()}
            className="py-2 text-[13px] text-subtle"
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

      {capturedRef.current.length > 0 && (
        <p className="mt-4 text-center text-[12px] text-subtle">
          已采集 {capturedRef.current.length} 张
        </p>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="text-right">{v}</dd>
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
