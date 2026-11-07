/**
 * 平台显示筛选
 *
 * 只控制侧栏显示哪些平台。勾掉不会删任何东西：渲染器、台账、AI 能力都还在，
 * 只是列表里不占位置。所以这里不做二次确认，随手勾回来就行。
 */

import { platformGroups } from '../renderers'
import { sortByWidth } from '../core/platform-visibility'

interface Props {
  open: boolean
  onClose: () => void
  hidden: Set<string>
  onToggle: (id: string) => void
  onReset: () => void
}

const GROUPS = platformGroups
const TOTAL = GROUPS.reduce((n, g) => n + g.list.length, 0)

export function PlatformFilterSheet({ open, onClose, hidden, onToggle, onReset }: Props) {
  if (!open) return null

  const shown = TOTAL - [...hidden].filter((id) => GROUPS.some((g) => g.list.some((p) => p.id === id))).length

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">显示哪些平台</span>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="notice notice-info">
            <span className="notice-mark">i</span>
            <span>
              勾掉只是<b>不在侧栏显示</b>，平台本身没被删——台账、复盘、批量生成都照常。
              列表按名字长短排列，短的在上面。
            </span>
          </div>

          {GROUPS.map((g) => {
            const list = sortByWidth(g.list)
            const visibleCount = list.filter((p) => !hidden.has(p.id)).length
            return (
              <div className="filter-group" key={g.id}>
                <div className="filter-group-label">
                  <span>{g.label}</span>
                  <span className="count">
                    {visibleCount}/{list.length}
                  </span>
                </div>

                {list.map((p) => (
                  <label className={`filter-row ${hidden.has(p.id) ? 'is-hidden' : ''}`} key={p.id}>
                    <input type="checkbox" checked={!hidden.has(p.id)} onChange={() => onToggle(p.id)} />
                    <span className="filter-row-body">
                      <span className="filter-row-name">{p.name}</span>
                      <span className="filter-row-hint">{p.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )
          })}
        </div>

        <div className="modal-foot">
          <span className="filter-count">
            已显示 {shown}/{TOTAL}
          </span>
          <button className="btn btn-sm" onClick={onReset} disabled={hidden.size === 0}>
            全部显示
          </button>
          <button className="btn btn-sm btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
