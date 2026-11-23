/**
 * 快速切换平台。
 *
 * 平台多起来后，侧栏扫描一次成本并不低。⌘K 提供一条只服务于高频操作的捷径，
 * 输入平台名、用途或类型即可过滤，↑↓ 选择，回车打开。
 *
 * 读屏走 APG 的 combobox + listbox：焦点始终留在输入框，键盘选中的那一条
 * 用 aria-activedescendant 指出来，aria-selected 跟着它走。
 * 「当前所在的平台」是另一回事：视觉上是左侧强调条（.active），读屏补一句「当前平台」。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from './Modal'
import { shortcutLabel } from '../core/keys'

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
  /** 键盘 / 鼠标选中的那一条（在 filtered 里的下标） */
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
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

  const current = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1)
  const optionId = (id: string) => `palette-opt-${id}`

  /**
   * 选中项滚出可视区时把列表滚回来。
   * 只动 listRef 的 scrollTop，不用 scrollIntoView —— 后者会连弹层外的页面一起滚。
   */
  useEffect(() => {
    if (!open || current < 0) return
    const list = listRef.current
    const row = list?.children[current]
    if (!list || !(row instanceof HTMLElement)) return
    const box = list.getBoundingClientRect()
    const rect = row.getBoundingClientRect()
    if (rect.top < box.top) list.scrollTop -= box.top - rect.top
    else if (rect.bottom > box.bottom) list.scrollTop += rect.bottom - box.bottom
  }, [open, current])

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
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
          }}
          onKeyDown={(event) => {
            // 输入法组字时的回车 / 方向键都归输入法：原来拼音选字按回车会直接跳走
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              if (filtered.length === 0) return
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((current + step + filtered.length) % filtered.length)
              return
            }
            if (event.key === 'Enter' && current >= 0) {
              event.preventDefault()
              choose(filtered[current].id)
            }
          }}
          placeholder="输入平台名、用途或类型…"
          aria-label="搜索平台"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={filtered.length > 0}
          aria-controls="palette-listbox"
          aria-activedescendant={current >= 0 ? optionId(filtered[current].id) : undefined}
        />
        <kbd>ESC</kbd>
      </div>

      <div className="palette-list" id="palette-listbox" role="listbox" aria-label="平台列表" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="palette-empty">没有匹配的平台。试试「公众号」「改写」或「配图」。</div>
        ) : (
          filtered.map((platform, index) => (
            <button
              key={platform.id}
              id={optionId(platform.id)}
              className={[
                'palette-row',
                active === platform.id ? 'active' : '',
                index === current ? 'is-highlighted' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="option"
              aria-selected={index === current}
              onClick={() => choose(platform.id)}
              // 鼠标划过就把它设为选中项：悬停和键盘共用一个高亮，回车打开的就是看到的那条。
              // 用 pointermove 而不是 pointerenter：列表滚动时从静止的指针下滑过，不该抢走键盘选中
              onPointerMove={() => {
                if (index !== current) setActiveIndex(index)
              }}
            >
              <span className="palette-row-name">
                {platform.name}
                {active === platform.id ? <span className="sr-only">（当前平台）</span> : null}
              </span>
              <span className="palette-row-hint">{platform.hint}</span>
              <span className="palette-row-group">{platform.group}</span>
            </button>
          ))
        )}
      </div>

      <div className="palette-foot">
        <span>↑↓ 选择 · 回车打开</span>
        <span>{shortcutLabel('K')} 随时呼出</span>
      </div>
    </Modal>
  )
}
