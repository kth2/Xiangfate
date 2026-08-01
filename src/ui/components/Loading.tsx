export function Loading({ label = '正在准备' }: { label?: string }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4">
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-[var(--color-gold-400)]" />
      </div>
      <p className="font-title text-sm tracking-[0.3em] text-muted">{label}</p>
    </div>
  )
}
