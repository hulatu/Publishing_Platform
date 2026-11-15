/**
 * 发布准备
 *
 * 把标题、正文、合规、素材这些发布前信息收进一个清单。
 * 主界面只显示「已就绪 / 总数」，缺项时再展开处理，避免顶部一排入口同时抢注意力。
 */

import { Modal } from './Modal'

export type ReadinessTone = 'ok' | 'note' | 'warn' | 'error'

export interface ReadinessDetail {
  label: string
  text: string
  tone?: Exclude<ReadinessTone, 'ok'>
}

export interface ReadinessItem {
  id: string
  label: string
  summary: string
  tone: ReadinessTone
  /** 补充项不参与发布准备分数，但仍需要一个固定入口 */
  optional?: boolean
  actionLabel?: string
  onAction?: () => void
  details?: ReadinessDetail[]
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  platformName: string
  items: ReadinessItem[]
}

const TONE_LABEL: Record<ReadinessTone, string> = {
  ok: '已就绪',
  note: '待确认',
  warn: '建议处理',
  error: '需处理',
}

export function ReadinessSheet({ open, onClose, title, platformName, items }: Props) {
  const requiredItems = items.filter((item) => !item.optional)
  const optionalItems = items.filter((item) => item.optional)
  const ready = requiredItems.filter((item) => item.tone === 'ok').length
  const hasError = requiredItems.some((item) => item.tone === 'error')
  const hasAttention = requiredItems.some((item) => item.tone === 'warn' || item.tone === 'note')
  const overallTone: ReadinessTone = hasError ? 'error' : hasAttention ? 'warn' : 'ok'
  const overallText = hasError
    ? '先处理标红项目，再复制发布'
    : hasAttention
      ? '可以发布，仍有几项建议确认'
      : '所有项目已就绪，可以复制发布'

  return (
    <Modal open={open} onClose={onClose} label="发布准备" className="readiness-modal">
      <div className="modal-head">
        <div>
          <div className="modal-title">发布准备</div>
          <div className="ledger-sub">
            {platformName} · {title || '未命名文章'}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="modal-body readiness-body">
        <div className={`readiness-overview ${overallTone}`}>
          <div className="readiness-score">
            <strong>{ready}</strong>
            <span>/ {requiredItems.length}</span>
          </div>
          <div className="readiness-overview-copy">
            <div className="readiness-overview-title">{overallText}</div>
          </div>
        </div>

        <div className="readiness-list">
          {[...requiredItems, ...optionalItems].map((item, index) => (
            <div key={item.id}>
              {index === requiredItems.length && optionalItems.length > 0 ? (
                <div className="readiness-optional-label">补充项</div>
              ) : null}
              <section className={`readiness-item tone-${item.tone}`}>
                <span className="readiness-mark" aria-hidden />
                <div className="readiness-item-body">
                  <div className="readiness-item-head">
                    <span className="readiness-item-label">{item.label}</span>
                    <span className="readiness-state">
                      {item.optional ? '可选' : TONE_LABEL[item.tone]}
                    </span>
                  </div>
                  <div className="readiness-item-summary">{item.summary}</div>
                  {item.details?.length ? (
                    <div className="readiness-details">
                      {item.details.map((detail, detailIndex) => (
                        <div
                          className={`readiness-detail ${detail.tone ? `tone-${detail.tone}` : ''}`}
                          key={`${detail.label}-${detailIndex}`}
                        >
                          <span>{detail.label}</span>
                          <p>{detail.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {item.actionLabel && item.onAction ? (
                  <button className="btn btn-sm readiness-action" onClick={item.onAction}>
                    {item.actionLabel}
                  </button>
                ) : null}
              </section>
            </div>
          ))}
        </div>
      </div>

    </Modal>
  )
}
