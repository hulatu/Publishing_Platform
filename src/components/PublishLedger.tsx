/**
 * 发布台账
 *
 * 一篇文章要发 8 个地方，靠脑子记不住发到第几个了。
 * 这里把 8 个平台摊开：已发的时间、发布后的链接、一键取消标记。
 * 复制成功会自动标记，这里主要是事后核对和补链接。
 */

import { convertPlatforms, rewritePlatforms } from '../renderers'
import { formatAt, type ArticleLedger } from '../core/ledger'

interface Props {
  open: boolean
  onClose: () => void
  /** 文章标题，让用户确认自己在看哪一篇的台账 */
  title: string
  ledger: ArticleLedger
  onMark: (platformId: string) => void
  onUnmark: (platformId: string) => void
  onSetUrl: (platformId: string, url: string) => void
  onClear: () => void
}

const GROUPS = [
  { label: '格式转换', list: convertPlatforms },
  { label: '内容改写', list: rewritePlatforms },
]

export function PublishLedger({ open, onClose, title, ledger, onMark, onUnmark, onSetUrl, onClear }: Props) {
  if (!open) return null

  const total = convertPlatforms.length + rewritePlatforms.length
  const done = Object.keys(ledger).length

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal ledger-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">发布台账</div>
            <div className="ledger-sub">
              《{title}》· 已发 <b>{done}</b> / {total}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body ledger-body">
          <div className="ledger-progress" aria-hidden>
            <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </div>

          {GROUPS.map((g) => (
            <div className="ledger-group" key={g.label}>
              <div className="ledger-group-label">{g.label}</div>
              {g.list.map((p) => {
                const rec = ledger[p.id]
                return (
                  <div className={`ledger-row ${rec ? 'done' : ''}`} key={p.id}>
                    <div className="ledger-name">
                      <span className={`ledger-tick ${rec ? 'on' : ''}`} aria-hidden>
                        {rec ? '✓' : ''}
                      </span>
                      <span className="ledger-name-text">{p.name}</span>
                    </div>

                    <div className="ledger-status">
                      {rec ? formatAt(rec.at) : '未发'}
                    </div>

                    <input
                      className="field-input ledger-url"
                      value={rec?.url ?? ''}
                      placeholder={rec ? '粘贴发布后的链接' : '标记后才可填链接'}
                      disabled={!rec}
                      onChange={(e) => onSetUrl(p.id, e.target.value)}
                      spellCheck={false}
                    />

                    <button
                      className="btn btn-sm ledger-btn"
                      onClick={() => (rec ? onUnmark(p.id) : onMark(p.id))}
                    >
                      {rec ? '取消' : '标记已发'}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="modal-foot ledger-foot">
          <button className="btn btn-sm" onClick={onClear} disabled={done === 0}>
            清空这篇的台账
          </button>
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
