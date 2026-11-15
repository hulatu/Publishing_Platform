/**
 * 快速切换平台。
 *
 * 平台多起来后，侧栏扫描一次成本并不低。⌘K 提供一条只服务于高频操作的捷径，
 * 输入平台名、用途或类型即可过滤，回车选中第一条。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'

export interface PalettePlatform {
  id: string
  name: string
  hint: string
  group: string
}

interface Props {
  open: boolean
  onClose: () => void
  active: string
  platforms: PalettePlatform[]
  onSelect: (id: string) => void
}

export function PlatformPalette({ open, onClose, active, platforms, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return platforms
    return platforms.filter((platform) =>
      `${platform.name} ${platform.hint} ${platform.group}`.toLowerCase().includes(q),
    )
  }, [platforms, query])

  const choose = (id: string) => {
    onSelect(id)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} label="快速切换平台" className="palette-modal">
      <div className="palette-search-wrap">
        <span className="palette-search-icon" aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          className="palette-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && filtered[0]) {
              event.preventDefault()
              choose(filtered[0].id)
            }
          }}
          placeholder="输入平台名、用途或类型…"
          aria-label="搜索平台"
        />
        <kbd>ESC</kbd>
      </div>

      <div className="palette-list" role="listbox" aria-label="平台列表">
        {filtered.length === 0 ? (
          <div className="palette-empty">没有匹配的平台。试试「公众号」「改写」或「配图」。</div>
        ) : (
          filtered.map((platform) => (
            <button
              key={platform.id}
              className={`palette-row ${active === platform.id ? 'active' : ''}`}
              role="option"
              aria-selected={active === platform.id}
              onClick={() => choose(platform.id)}
            >
              <span className="palette-row-name">{platform.name}</span>
              <span className="palette-row-hint">{platform.hint}</span>
              <span className="palette-row-group">{platform.group}</span>
            </button>
          ))
        )}
      </div>

      <div className="palette-foot">
        <span>回车打开第一条</span>
        <span>⌘K 随时呼出</span>
      </div>
    </Modal>
  )
}
