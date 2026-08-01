import type { AnalysisType } from '@/core/types'

/**
 * 四相图标。线描风格，白描意象，纯 SVG 无外部资源。
 * 面相=三停横线的面轮廓；手相=掌纹；骨相=颅骨框架；体相=站姿人形。
 */
export function TypeGlyph({
  type,
  size = 40,
  color = 'currentColor',
}: {
  type: AnalysisType
  size?: number
  color?: string
}) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (type) {
    case 'mianxiang':
      return (
        <svg {...common}>
          {/* 面轮廓 */}
          <path d="M24 6c8 0 13 5 13 13 0 9-5 17-13 23-8-6-13-14-13-23C11 11 16 6 24 6Z" />
          {/* 三停 */}
          <path d="M13 17h22M14.5 27h19" strokeDasharray="2 2.5" opacity=".65" />
          {/* 眉眼 */}
          <path d="M17 21.5h4M27 21.5h4" />
          {/* 鼻 */}
          <path d="M24 22v5.5" opacity=".8" />
          {/* 口 */}
          <path d="M20.5 32c2 1.4 5 1.4 7 0" />
        </svg>
      )

    case 'shouxiang':
      return (
        <svg {...common}>
          {/* 掌面轮廓：指根一线，掌缘收至腕 */}
          <path d="M16 21v13c0 4.4 3.4 8 8 8s8-3.6 8-8V21" />
          <path d="M16 34.5c-2-1-3-2.8-3-5v-4.2c0-1.2 1-2.2 2.2-2.2s2.2 1 2.2 2.2" />
          {/* 四指 */}
          <path d="M18.5 21v-6.5M23 21V11M27.5 21v-9M31.5 21v-5.5" />
          {/* 三大主线：感情线在上，智慧线居中，生命线绕拇指根 */}
          <path d="M18 25.5c3.6 1.3 7.6 1.4 11.5.2" opacity=".7" />
          <path d="M17.5 29.5c3.8 1.6 8 1.7 11.8.4" opacity=".55" />
          <path d="M18.5 24c1.4 4.2 2 8.4 1.8 12.5" opacity=".45" />
        </svg>
      )

    case 'guxiang':
      return (
        <svg {...common}>
          {/* 颅顶 */}
          <path d="M24 7c8.3 0 14 5.6 14 13.5 0 4.4-1.6 7.6-3.8 9.7-1.3 1.2-2 2.3-2 4V38c0 1.6-1.3 3-3 3H18.8c-1.7 0-3-1.4-3-3v-3.8c0-1.7-.7-2.8-2-4C11.6 28.1 10 24.9 10 20.5 10 12.6 15.7 7 24 7Z" />
          {/* 颧骨 */}
          <path d="M14 24.5c2.4 1.6 4.4 2.2 6 2M34 24.5c-2.4 1.6-4.4 2.2-6 2" opacity=".75" />
          {/* 眼窝 */}
          <circle cx="18.5" cy="20" r="2.6" opacity=".8" />
          <circle cx="29.5" cy="20" r="2.6" opacity=".8" />
          {/* 下颌 */}
          <path d="M19 34.5h10" opacity=".6" />
        </svg>
      )

    case 'tixiang':
      return (
        <svg {...common}>
          {/* 头 */}
          <circle cx="24" cy="10" r="4" />
          {/* 躯干中轴 */}
          <path d="M24 14.5v14" />
          {/* 肩 */}
          <path d="M15 19h18" />
          {/* 臂 */}
          <path d="M15 19l-3 12M33 19l3 12" />
          {/* 髋 */}
          <path d="M18.5 28.5h11" />
          {/* 腿 */}
          <path d="M18.5 28.5 17 42M29.5 28.5 31 42" />
          {/* 铅垂参考线 */}
          <path d="M24 4v40" strokeDasharray="1.5 3" opacity=".35" />
        </svg>
      )
  }
}
