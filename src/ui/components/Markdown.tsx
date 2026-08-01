import { useMemo } from 'react'

/**
 * 极简 Markdown 渲染。只支持报告实际用到的语法：
 * ## 二级标题、- 无序列表、**粗体**、段落。
 *
 * 不引 markdown 库：我们完全控制输入格式（System Prompt 约束 + guard 校验），
 * 一个通用解析器在这里是纯负担（体积、XSS 面）。
 * 所有文本都走 React 的文本节点，天然转义。
 */

interface Block {
  kind: 'heading' | 'para' | 'list'
  text?: string
  items?: string[]
}

function parse(md: string): Block[] {
  const blocks: Block[] = []
  let list: string[] = []

  const flush = () => {
    if (list.length) {
      blocks.push({ kind: 'list', items: list })
      list = []
    }
  }

  for (const rawLine of md.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push({ kind: 'heading', text: h[1].trim() })
      continue
    }
    const li = /^\s*[-*·]\s+(.*)$/.exec(line)
    if (li) {
      list.push(li[1].trim())
      continue
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      flush()
      continue
    }
    flush()
    blocks.push({ kind: 'para', text: line.trim() })
  }
  flush()
  return blocks
}

/** 只处理 **粗体**，其余原样输出为文本节点 */
function inline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
      <strong key={i} className="font-medium">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

export function Markdown({ text, accent }: { text: string; accent?: string }) {
  const blocks = useMemo(() => parse(text), [text])

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') {
          return (
            <h3
              key={i}
              className="font-title mt-2 flex items-center gap-2 text-[15px] tracking-[0.15em] first:mt-0"
            >
              <span
                aria-hidden
                className="h-3 w-[2px]"
                style={{ background: accent ?? 'var(--color-gold-400)' }}
              />
              {b.text}
            </h3>
          )
        }
        if (b.kind === 'list') {
          return (
            <ul key={i} className="flex flex-col gap-2">
              {b.items!.map((it, j) => (
                <li key={j} className="flex gap-2.5 text-[13.5px] leading-loose text-muted">
                  <span
                    aria-hidden
                    className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full"
                    style={{ background: accent ?? 'var(--color-gold-400)' }}
                  />
                  <span>{inline(it)}</span>
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className="text-[13.5px] leading-loose text-muted">
            {inline(b.text!)}
          </p>
        )
      })}
    </div>
  )
}
