import { Link } from 'react-router'

/** 历史记录。第三步接入 IndexedDB（只存 envelope + 报告正文，绝不存图）。 */
export function History() {
  return (
    <div className="page px-6 pt-8 pb-16">
      <div className="flex items-center justify-between">
        <Link to="/" className="font-title text-[13px] tracking-[0.1em] text-muted">
          ← 返回
        </Link>
        <h1 className="font-title text-base tracking-[0.25em]">往迹</h1>
        <span className="w-12" />
      </div>

      <div className="rule-gold my-6" />

      <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-3">
        <p className="text-[13px] text-muted">还没有记录</p>
        <p className="max-w-[16rem] text-center text-[12px] leading-relaxed text-subtle">
          分析完成后会存在这台设备上，可按类型筛选，也可以随时一键清除。
        </p>
      </div>

      <Link to="/" className="btn-seal mt-6 h-12 w-full text-[15px]">
        去看一相
      </Link>
    </div>
  )
}
