/**
 * 提示条
 *
 * 一篇文章可能有十几条解析/转换提示。原来是一条一个色块堆在正文上方，
 * 三条就能把正文推下去 150px，而且颜色一样、分不出轻重。
 *
 * 现在合并成一条：默认只露最要紧的那条，其余收进「还有 N 条」。
 * 硬错误（会让产物不可用）单独占一条红条，永远展开。
 */

import { useState, type ReactNode } from 'react'

export type NoticeLevel = 'error' | 'warn' | 'info'

export interface NoticeItem {
  text: string
  level: NoticeLevel
}

interface Props {
  items: NoticeItem[]
  /** 错误条右侧的补救动作，比如「按 H2 拆篇并导出」 */
  action?: ReactNode
}

const ORDER: Record<NoticeLevel, number> = { error: 0, warn: 1, info: 2 }

export function NoticeStack({ items, action }: Props) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  const sorted = [...items].sort((a, b) => ORDER[a.level] - ORDER[b.level])
  const first = sorted[0]
  const rest = sorted.length - 1

  return (
    <div className={`notice-stack level-${first.level}`}>
      <div className="notice-line">
        <span className={`notice-dot level-${first.level}`} aria-hidden />
        <span className="notice-text">{first.text}</span>

        {rest > 0 ? (
          <button className="notice-more" onClick={() => setOpen((v) => !v)}>
            {open ? '收起' : `还有 ${rest} 条`}
            <span className={`caret ${open ? 'open' : ''}`}>▸</span>
          </button>
        ) : null}

        {action ? <div className="notice-action">{action}</div> : null}
      </div>

      {open && rest > 0 ? (
        <ul className="notice-list">
          {sorted.slice(1).map((n, i) => (
            <li key={i} className={`notice-item level-${n.level}`}>
              <span className={`notice-dot level-${n.level}`} aria-hidden />
              <span>{n.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
