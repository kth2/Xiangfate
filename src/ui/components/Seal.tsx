/**
 * 朱砂印章。首页与报告页的视觉落款。
 * 纯 CSS/SVG，无外部资源。
 */
export function Seal({
  text = '相由',
  size = 44,
  className = '',
}: {
  text?: string
  size?: number
  className?: string
}) {
  const chars = [...text]
  return (
    <span
      aria-hidden
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        background: 'var(--color-cinnabar-500)',
        borderRadius: 2,
        boxShadow: 'inset 0 0 0 1.5px rgba(250,247,240,0.85)',
      }}
    >
      <span
        className="font-title leading-none text-[var(--color-paper-50)]"
        style={{
          fontSize: size * (chars.length > 2 ? 0.28 : 0.36),
          writingMode: chars.length > 2 ? 'vertical-rl' : 'horizontal-tb',
          letterSpacing: chars.length > 2 ? '0.05em' : '0.02em',
        }}
      >
        {text}
      </span>
    </span>
  )
}
