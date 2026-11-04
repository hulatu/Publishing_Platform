/**
 * 草稿箱
 *
 * 一屏看完「我最近动过哪几篇、每篇都攒下了什么」。列表里最有信息量的不是时间，
 * 而是 marks（摘要 6 节 / 文案 4 个平台 / 标题 8 条）—— 用户扫一眼就知道
 * 哪一份值得打开，不用逐个点进去看。
 *
 * 删除是不可撤销的，所以不做「悬停出现 ×」那套：按钮要一直可见，
 * 且删之前要再点一次确认（同一行按钮变红、文字变成「确定删除」）。
 */

import { useState } from 'react'
import { draftValue, formatAgo, MAX_DRAFTS, type DraftSnapshot } from '../core/drafts'

interface Props {
  open: boolean
  onClose: () => void
  drafts: DraftSnapshot[]
  /** 当前打开的那篇，列表里标出来，避免用户重复点自己 */
  currentKey: string
  onOpen: (key: string) => void
  onDelete: (key: string) => void
  onClearAll: () => void
}

function sizeOf(drafts: DraftSnapshot[]): string {
  const bytes = new Blob([JSON.stringify(drafts)]).size
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function DraftsSheet({ open, onClose, drafts, currentKey, onOpen, onDelete, onClearAll }: Props) {
  /** 待确认删除的 key —— 第一次点只是「举起来」，第二次才真删 */
  const [confirming, setConfirming] = useState<string | null>(null)
  /** 清空全部也要二次确认 */
  const [confirmClear, setConfirmClear] = useState(false)

  if (!open) return null

  const handleDelete = (key: string) => {
    if (confirming === key) {
      onDelete(key)
      setConfirming(null)
    } else {
      setConfirming(key)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal drafts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">草稿箱</div>
            <div className="ledger-sub">
              {drafts.length > 0
                ? `${drafts.length} 篇 · 共 ${sizeOf(drafts)} · 上限 ${MAX_DRAFTS} 篇，超出淘汰最旧的`
                : '自动保存，关掉页面也不丢'}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body drafts-body">
          {drafts.length === 0 ? (
            <div className="check-empty" style={{ padding: '36px 0' }}>
              还没有草稿。导入一篇文章就会自动存下来 —— 摘要、四平台文案、标题候选都在里面，
              下次打开直接接着做。
            </div>
          ) : (
            drafts.map((d) => {
              const { worth, marks } = draftValue(d)
              const isCurrent = d.key === currentKey
              const chars = d.source.length

              return (
                <div className={`draft-row ${isCurrent ? 'current' : ''}`} key={d.key}>
                  <div className="draft-main">
                    <div className="draft-title-row">
                      <span className="draft-title">{d.title || '（无标题）'}</span>
                      {isCurrent ? <span className="draft-tag">当前</span> : null}
                      {worth ? null : <span className="draft-tag muted">仅正文</span>}
                    </div>

                    <div className="draft-meta">
                      <span>{formatAgo(d.updatedAt)}</span>
                      <span className="draft-dot">·</span>
                      <span>{d.fileName || '粘贴导入'}</span>
                      <span className="draft-dot">·</span>
                      <span>{chars.toLocaleString()} 字符</span>
                    </div>

                    {marks.length > 0 ? (
                      <div className="draft-marks">
                        {marks.map((m) => (
                          <span className="draft-mark" key={m}>
                            {m}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="draft-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => onOpen(d.key)}
                      disabled={isCurrent}
                      title={isCurrent ? '已经打开了' : '恢复这篇的正文、摘要与 AI 文案'}
                    >
                      {isCurrent ? '已打开' : '打开'}
                    </button>
                    <button
                      className={`btn btn-sm draft-del ${confirming === d.key ? 'danger' : ''}`}
                      onClick={() => handleDelete(d.key)}
                      onBlur={() => confirming === d.key && setConfirming(null)}
                    >
                      {confirming === d.key ? '确定删除' : '删除'}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="modal-foot">
          <button
            className={`btn btn-sm ${confirmClear ? 'btn-danger' : ''}`}
            disabled={drafts.length === 0}
            onClick={() => {
              if (confirmClear) {
                onClearAll()
                setConfirmClear(false)
              } else {
                setConfirmClear(true)
              }
            }}
            onBlur={() => setConfirmClear(false)}
          >
            {confirmClear ? `确定清空 ${drafts.length} 篇` : '清空全部'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
