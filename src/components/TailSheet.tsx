/**
 * 公众号文末组件编辑
 *
 * 右边是实时预览 —— 尾部这三块的样式全靠内联，光看输入框想象不出「浅底 + 左竖线」
 * 长什么样，改完还得复制到公众号里才知道效果，来回一次太贵。
 *
 * 改动即时生效（没有「保存」按钮）：这些东西都是几行字，用户改一个字就想看效果，
 * 再点一次保存纯属多余。写盘在 App 里做。
 */

import { useState } from 'react'
import { buildTailHtml, TAIL_VARS, type TailConfig } from '../core/tail'
import { getWechatTheme } from '../themes/wechat'

interface Props {
  open: boolean
  onClose: () => void
  cfg: TailConfig
  account: string
  themeId: string
  onChange: (cfg: TailConfig) => void
  onAccountChange: (name: string) => void
}

const MAX_HISTORY = 4

export function TailSheet({ open, onClose, cfg, account, themeId, onChange, onAccountChange }: Props) {
  const [tab, setTab] = useState<'form' | 'preview'>('form')
  if (!open) return null

  const theme = getWechatTheme(themeId)
  const preview = buildTailHtml(cfg, theme, account)

  const patchFollow = (patch: Partial<TailConfig['follow']>) =>
    onChange({ ...cfg, follow: { ...cfg.follow, ...patch } })
  const patchHistory = (patch: Partial<TailConfig['history']>) =>
    onChange({ ...cfg, history: { ...cfg.history, ...patch } })
  const patchCopyright = (patch: Partial<TailConfig['copyright']>) =>
    onChange({ ...cfg, copyright: { ...cfg.copyright, ...patch } })

  const setItem = (i: number, patch: Partial<TailConfig['history']['items'][number]>) => {
    const items = cfg.history.items.map((it, j) => (j === i ? { ...it, ...patch } : it))
    patchHistory({ items })
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal tail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">公众号文末</div>
            <div className="ledger-sub">关注引导 / 往期推荐 / 版权 · 拼在正文之后，计入 20000 字符上限</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="segmented tail-tabs">
          <button className={tab === 'form' ? 'active' : ''} onClick={() => setTab('form')}>
            编辑
          </button>
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>
            预览
          </button>
        </div>

        <div className="modal-body">
          {tab === 'form' ? (
            <>
              <div className="field">
                <label className="field-label">账号名（替换文案里的 {'{account}'}）</label>
                <input
                  className="field-input"
                  value={account}
                  onChange={(e) => onAccountChange(e.target.value)}
                  placeholder="例如：胡拉图说"
                />
              </div>

              {/* 关注引导 */}
              <div className="tail-block">
                <label className="check-row tail-toggle">
                  <input
                    type="checkbox"
                    checked={cfg.follow.on}
                    onChange={(e) => patchFollow({ on: e.target.checked })}
                  />
                  <span className="tail-block-name">关注引导</span>
                </label>
                {cfg.follow.on ? (
                  <div className="tail-block-body">
                    <input
                      className="field-input"
                      value={cfg.follow.title}
                      onChange={(e) => patchFollow({ title: e.target.value })}
                      placeholder="小标题（选填，例如：关于作者）"
                    />
                    <textarea
                      className="field-textarea"
                      style={{ marginTop: 8, minHeight: 64 }}
                      value={cfg.follow.text}
                      onChange={(e) => patchFollow({ text: e.target.value })}
                      placeholder="如果这篇内容对你有用，欢迎关注「{account}」"
                    />
                  </div>
                ) : null}
              </div>

              {/* 往期推荐 */}
              <div className="tail-block">
                <label className="check-row tail-toggle">
                  <input
                    type="checkbox"
                    checked={cfg.history.on}
                    onChange={(e) => patchHistory({ on: e.target.checked })}
                  />
                  <span className="tail-block-name">往期推荐</span>
                </label>
                {cfg.history.on ? (
                  <div className="tail-block-body">
                    <input
                      className="field-input"
                      value={cfg.history.title}
                      onChange={(e) => patchHistory({ title: e.target.value })}
                      placeholder="小标题（选填，例如：往期推荐）"
                    />
                    <div className="tail-items">
                      {cfg.history.items.map((item, i) => (
                        <div className="tail-item" key={i}>
                          <span className="tail-item-idx">{String(i + 1).padStart(2, '0')}</span>
                          <input
                            className="field-input"
                            value={item.title}
                            onChange={(e) => setItem(i, { title: e.target.value })}
                            placeholder="往期文章标题"
                          />
                          <input
                            className="field-input tail-item-url"
                            value={item.url}
                            onChange={(e) => setItem(i, { url: e.target.value })}
                            placeholder="链接（选填，微信会剥离正文外链）"
                          />
                          <button
                            className="icon-btn"
                            title="删除这一条"
                            onClick={() =>
                              patchHistory({ items: cfg.history.items.filter((_, j) => j !== i) })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                    {cfg.history.items.length < MAX_HISTORY ? (
                      <button
                        className="btn btn-sm"
                        style={{ marginTop: 8 }}
                        onClick={() =>
                          patchHistory({ items: [...cfg.history.items, { title: '', url: '' }] })
                        }
                      >
                        + 加一条
                      </button>
                    ) : null}
                    <div className="field-hint">
                      只填标题也能用。带链接的条目粘贴后要在公众号编辑器里用「超链接」重新挂上 ——
                      未认证号正文里的外链会被整条剥离。
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 版权 */}
              <div className="tail-block">
                <label className="check-row tail-toggle">
                  <input
                    type="checkbox"
                    checked={cfg.copyright.on}
                    onChange={(e) => patchCopyright({ on: e.target.checked })}
                  />
                  <span className="tail-block-name">版权声明</span>
                </label>
                {cfg.copyright.on ? (
                  <div className="tail-block-body">
                    <input
                      className="field-input"
                      value={cfg.copyright.text}
                      onChange={(e) => patchCopyright({ text: e.target.value })}
                      placeholder="© {year} {account} · 转载请注明出处"
                    />
                  </div>
                ) : null}
              </div>

              <div className="field-hint" style={{ marginTop: 10 }}>
                可用占位符：{TAIL_VARS.join('、')}
              </div>
            </>
          ) : (
            <div className="tail-preview">
              {preview.html ? (
                <div dangerouslySetInnerHTML={{ __html: preview.html }} />
              ) : (
                <div className="check-empty" style={{ padding: '30px 0' }}>
                  三块都没启用，文末不会追加任何内容。
                </div>
              )}
              <div className="field-hint" style={{ marginTop: 14 }}>
                这段 HTML 共 {[...preview.html].length} 字符，会拼在正文和参考链接之后。
                预览用的是当前公众号主题（{theme.name}）的配色。
              </div>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
