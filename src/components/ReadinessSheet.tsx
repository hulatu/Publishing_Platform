/**
 * 发布检查
 *
 * 一篇文章发布前要看的东西都在这里：标题 / 正文 / 合规 / 素材是清单，
 * 转换统计、平台提示、格式说明、外链与文末这类附加产物按块列在下面。
 *
 * 主界面只留预览工具栏里的一个小 chip —— 预览区上方不再长期占一行
 * 「全内联样式 · 正文 224 字」，需要数字时再打开这面板。
 */

import { Modal } from './Modal'
import { NoticeStack, type NoticeItem } from './NoticeStack'

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
  /** 补充项不参与发布检查分数，但仍需要一个固定入口 */
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
  /** 当前平台一句话定位，原来挂在主标题下面 */
  hint?: string
  /** 平台硬限制，和 hint 一起收进面板 */
  limits?: string
  /** 渲染产物的统计：字数、HTML 体积、图片数、外链数…… */
  stats?: { label: string; value: string; level?: 'ok' | 'warn' | 'error' }[]
  /** 需要人看一眼的转换提示 */
  notices?: NoticeItem[]
  /** 中性转换说明：不是问题，只是「做了什么」 */
  notes?: string[]
  /** 解析阶段的提示，原来在操作条里 */
  parseWarnings?: string[]
  /** 附加产物：文末、参考链接、话题标签等 */
  extras?: { title: string; items: string[] }[]
}

const TONE_LABEL: Record<ReadinessTone, string> = {
  ok: '已就绪',
  note: '待确认',
  warn: '建议处理',
  error: '需处理',
}

export function ReadinessSheet({
  open,
  onClose,
  title,
  platformName,
  items,
  hint,
  limits,
  stats,
  notices,
  notes,
  parseWarnings,
  extras,
}: Props) {
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
    <Modal open={open} onClose={onClose} label="发布检查" className="readiness-modal">
      <div className="modal-head">
        <div>
          <div className="modal-title">发布检查</div>
          <div className="ledger-sub">
            {platformName} · {title || '未命名文章'}
          </div>
          {hint || limits ? (
            <div className="check-platform">
              {hint ? <span>{hint}</span> : null}
              {limits ? <span className="check-limit">{limits}</span> : null}
            </div>
          ) : null}
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

        {stats && stats.length > 0 ? (
          <section className="check-block">
            <div className="check-block-head">
              <span>转换结果</span>
              <span className="check-block-note">复制出去的实际数字</span>
            </div>
            <div className="check-stats">
              {stats.map((stat, index) => (
                <div className={`check-stat ${stat.level ?? ''}`} key={`${stat.label}-${index}`}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {notices && notices.length > 0 ? (
          <section className="check-block">
            <div className="check-block-head">
              <span>提示</span>
              <span className="check-block-note">不影响复制，发布前看一眼</span>
            </div>
            <NoticeStack items={notices} />
          </section>
        ) : null}

        {notes && notes.length > 0 ? (
          <section className="check-block">
            <div className="check-block-head">
              <span>转换说明</span>
              <span className="check-block-note">{notes.length} 条</span>
            </div>
            <ul className="check-notes">
              {notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {parseWarnings && parseWarnings.length > 0 ? (
          <section className="check-block">
            <div className="check-block-head">
              <span>解析提示</span>
              <span className="check-block-note">{parseWarnings.length} 条</span>
            </div>
            <ul className="check-notes">
              {parseWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {extras?.map((extra, index) => (
          <section className="check-block" key={`${extra.title}-${index}`}>
            <div className="check-block-head">
              <span>{extra.title}</span>
              <span className="check-block-note">{extra.items.length} 条</span>
            </div>
            <ul className="check-notes">
              {extra.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

    </Modal>
  )
}
