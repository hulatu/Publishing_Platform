/**
 * 发布台账
 *
 * 一篇文章要发 11 个地方，靠脑子记不住发到第几个了。
 * 这里把 11 个平台摊开：已复制、已发布、发布时间和链接分开记录。
 */

import { useEffect, useState } from 'react'
import { convertPlatforms, rewritePlatforms } from '../renderers'
import { formatAt, type ArticleLedger } from '../core/ledger'
import { Modal } from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  /** 文章标题，让用户确认自己在看哪一篇的台账 */
  title: string
  ledger: ArticleLedger
  /** 各平台当前内容状态，用于区分已生成 / 可转换 / 未生成 */
  contentStates: Record<string, LedgerContentState>
  /** 从发布轨道打开时，定位并短暂高亮当前平台 */
  focusPlatform?: string
  onSelectPlatform: (platformId: string) => void
  onMark: (platformId: string) => void
  onUnmark: (platformId: string) => void
  onSetUrl: (platformId: string, url: string) => void
  onClear: () => void
}

export type LedgerContentState = 'ready' | 'available' | 'pending' | 'running'

const GROUPS = [
  { label: '直接转换', list: convertPlatforms },
  { label: 'AI 改写', list: rewritePlatforms },
]

export function PublishLedger({
  open,
  onClose,
  title,
  ledger,
  contentStates,
  focusPlatform = '',
  onSelectPlatform,
  onMark,
  onUnmark,
  onSetUrl,
  onClear,
}: Props) {
  const [confirmClear, setConfirmClear] = useState(false)
  const [highlight, setHighlight] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all')

  useEffect(() => {
    if (!open || !focusPlatform) return
    setHighlight(focusPlatform)
    const frame = requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-ledger-platform="${focusPlatform}"]`)
        ?.scrollIntoView({ block: 'center' })
    })
    const timer = window.setTimeout(() => setHighlight(''), 1400)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [open, focusPlatform])

  if (!open) return null

  const total = convertPlatforms.length + rewritePlatforms.length
  const done = Object.values(ledger).filter((rec) => Boolean(rec.at)).length
  const prepared = Object.values(ledger).filter((rec) => !rec.at && Boolean(rec.copiedAt)).length
  const filteredGroups = GROUPS.map((group) => ({
    ...group,
    list: group.list.filter((platform) => {
      const published = Boolean(ledger[platform.id]?.at)
      return filter === 'all' || (filter === 'done' ? published : !published)
    }),
  })).filter((group) => group.list.length > 0)

  return (
    <Modal open={open} onClose={onClose} label="发布总览" className="ledger-modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">发布总览</div>
            <div className="ledger-sub">
              《{title}》· 已发 <b>{done}</b> / {total}
              {prepared > 0 ? ` · ${prepared} 个已复制待发布` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body ledger-body">
          <div className="segmented ledger-filters">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              全部 {total}
            </button>
            <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>
              待发布 {total - done}
            </button>
            <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>
              已发布 {done}
            </button>
          </div>

          {done === total ? (
            <div className="ledger-complete">
              <span aria-hidden>✓</span>
              {total} 个平台已全部发布
            </div>
          ) : null}

          <div className="ledger-columns" aria-hidden>
            <span>平台</span>
            <span>内容</span>
            <span>复制 / 发布</span>
            <span>链接</span>
            <span>操作</span>
          </div>

          {filteredGroups.length === 0 ? (
            <div className="check-empty">这个筛选下没有平台。</div>
          ) : (
            filteredGroups.map((g) => (
              <div className="ledger-group" key={g.label}>
              <div className="ledger-group-label">{g.label}</div>
              {g.list.map((p) => {
                const rec = ledger[p.id]
                const published = Boolean(rec?.at)
                const copied = !published && Boolean(rec?.copiedAt)
                const content = contentStates[p.id] ?? 'pending'
                const contentLabel =
                  content === 'ready'
                    ? '已生成'
                    : content === 'available'
                      ? '可转换'
                      : content === 'running'
                        ? '生成中'
                        : '未生成'
                return (
                  <div
                    className={`ledger-row ${published ? 'done' : copied ? 'prepared' : ''} ${highlight === p.id ? 'focused' : ''}`}
                    data-ledger-platform={p.id}
                    key={p.id}
                  >
                    <div className="ledger-name">
                      <span
                        className={`ledger-tick ${published ? 'on' : copied ? 'prepared' : ''}`}
                        aria-hidden
                      >
                        {published ? '✓' : copied ? '·' : ''}
                      </span>
                      <button
                        className="ledger-name-text"
                        onClick={() => {
                          onSelectPlatform(p.id)
                          onClose()
                        }}
                        title={`切换到${p.name}`}
                      >
                        {p.name}
                      </button>
                    </div>

                    <span className={`ledger-content ${content}`}>{contentLabel}</span>

                    <div className="ledger-status">
                      {rec?.at
                        ? `已发布 ${formatAt(rec.at)}`
                        : copied
                          ? `已复制 ${formatAt(rec.copiedAt ?? '')}`
                          : null}
                    </div>

                    <div className="ledger-link-cell">
                      {published ? (
                        <input
                          className="field-input ledger-url"
                          value={rec?.url ?? ''}
                          placeholder="粘贴发布后的链接"
                          onChange={(e) => onSetUrl(p.id, e.target.value)}
                          spellCheck={false}
                        />
                      ) : null}
                    </div>

                    <button
                      className="btn btn-sm ledger-btn"
                      onClick={() => (published ? onUnmark(p.id) : onMark(p.id))}
                    >
                      {published ? '取消发布' : '标记已发布'}
                    </button>
                  </div>
                )
              })}
              </div>
            ))
          )}
        </div>

        <div className="modal-foot ledger-foot">
          <button
            className={`btn btn-sm ${confirmClear ? 'btn-danger' : ''}`}
            onClick={() => {
              if (confirmClear) {
                onClear()
                setConfirmClear(false)
              } else {
                setConfirmClear(true)
              }
            }}
            onBlur={() => setConfirmClear(false)}
            disabled={done === 0 && prepared === 0}
          >
            {confirmClear ? '再点一次，清空台账' : '清空这篇的台账'}
          </button>
        </div>
    </Modal>
  )
}
