/**
 * 公众号文末组件编辑
 *
 * 右边是实时预览 —— 尾部这三块的样式全靠内联，光看输入框想象不出「浅底 + 左竖线」
 * 长什么样，改完还得复制到公众号里才知道效果，来回一次太贵。
 *
 * 改动即时生效（没有「保存」按钮）：这些东西都是几行字，用户改一个字就想看效果，
 * 再点一次保存纯属多余。写盘在 App 里做。
 */

import { useEffect, useRef, useState } from 'react'
import { buildTailHtml, wechatArticleUrl, TAIL_VARS, type TailConfig } from '../core/tail'
import { getWechatTheme } from '../themes/wechat'
import { Modal } from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  cfg: TailConfig
  account: string
  themeId: string
  /** 台账里已发布的公众号文章，可直接加进往期推荐 */
  published: { key: string; title: string; url: string }[]
  onChange: (cfg: TailConfig) => void
  onAccountChange: (name: string) => void
}

export function TailSheet({
  open, onClose, cfg, account, themeId, published, onChange, onAccountChange,
}: Props) {
  const [tab, setTab] = useState<'form' | 'preview'>('form')
  const titleRefs = useRef<(HTMLInputElement | null)[]>([])
  const focusLastRef = useRef(false)

  // 新增一条后把焦点放到它的标题输入框；不在弹窗里时不抢焦点
  useEffect(() => {
    if (!open || !focusLastRef.current) return
    focusLastRef.current = false
    titleRefs.current[cfg.history.items.length - 1]?.focus()
  }, [open, cfg.history.items.length])

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

  const addItem = () => {
    focusLastRef.current = true
    patchHistory({ items: [...cfg.history.items, { title: '', url: '' }] })
  }

  const addPublished = (item: { key: string; title: string; url: string }) => {
    const exists = cfg.history.items.some((it) => wechatArticleUrl(it.url) === item.url)
    if (exists) return
    focusLastRef.current = true
    patchHistory({
      items: [...cfg.history.items, { title: item.title, url: item.url }],
    })
  }

  const moveItem = (i: number, delta: -1 | 1) => {
    const j = i + delta
    if (j < 0 || j >= cfg.history.items.length) return
    const items = [...cfg.history.items]
    ;[items[i], items[j]] = [items[j], items[i]]
    patchHistory({ items })
  }

  /** 重复的公众号链接：粘贴后会出现两条一样的推荐 */
  const duplicates = new Set<number>()
  const seenUrls = new Set<string>()
  cfg.history.items.forEach((item, i) => {
    const url = wechatArticleUrl(item.url)
    if (!url) return
    if (seenUrls.has(url)) duplicates.add(i)
    else seenUrls.add(url)
  })

  return (
    <Modal open={open} onClose={onClose} label="公众号文末" className="tail-modal">
        <div className="modal-head">
          <div>
            <div className="modal-title">公众号文末</div>
            <div className="ledger-sub">关注引导 / 往期推荐 / 版权 · 拼在正文之后</div>
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
                <label className="field-label" htmlFor="tail-account">
                  账号名（替换文案里的 {'{account}'}）
                </label>
                <input
                  id="tail-account"
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
                      aria-label="关注引导小标题"
                      value={cfg.follow.title}
                      onChange={(e) => patchFollow({ title: e.target.value })}
                      placeholder="小标题（选填，例如：关于作者）"
                    />
                    <textarea
                      className="field-textarea mt-2"
                      aria-label="关注引导正文"
                      style={{ minHeight: 64 }}
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
                      aria-label="往期推荐小标题"
                      value={cfg.history.title}
                      onChange={(e) => patchHistory({ title: e.target.value })}
                      placeholder="小标题（选填，例如：往期推荐）"
                    />
                    {published.length > 0 ? (
                      <details className="tail-import">
                        <summary>从台账导入（{published.length} 篇已发布）</summary>
                        <div className="tail-import-list">
                          {published.map((p) => {
                            const added = cfg.history.items.some(
                              (it) => wechatArticleUrl(it.url) === p.url,
                            )
                            return (
                              <button
                                type="button"
                                className="tail-import-item"
                                key={p.key}
                                disabled={added}
                                title={p.url}
                                onClick={() => addPublished(p)}
                              >
                                <span className="tail-import-title">{p.title}</span>
                                <span className="tail-import-url">{added ? '已添加' : p.url}</span>
                              </button>
                            )
                          })}
                        </div>
                      </details>
                    ) : null}
                    <div className="tail-items">
                      {cfg.history.items.map((item, i) => {
                        const badLink = item.url.trim().length > 0 && !wechatArticleUrl(item.url)
                        const duplicate = duplicates.has(i)
                        return (
                          <div className="tail-item-row" key={i}>
                            <div className="tail-item">
                              <span className="tail-item-idx">{String(i + 1).padStart(2, '0')}</span>
                              <input
                                ref={(el) => {
                                  titleRefs.current[i] = el
                                }}
                                className="field-input"
                                aria-label={`第 ${i + 1} 条往期标题`}
                                value={item.title}
                                onChange={(e) => setItem(i, { title: e.target.value })}
                                placeholder="往期文章标题"
                              />
                              <input
                                className={`field-input tail-item-url${badLink || duplicate ? ' is-warn' : ''}`}
                                aria-label={`第 ${i + 1} 条往期链接`}
                                aria-invalid={badLink || duplicate || undefined}
                                value={item.url}
                                onChange={(e) => setItem(i, { url: e.target.value })}
                                placeholder="https://mp.weixin.qq.com/s/…"
                              />
                              <div className="tail-item-order">
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label={`第 ${i + 1} 条上移`}
                                  title="上移"
                                  disabled={i === 0}
                                  onClick={() => moveItem(i, -1)}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label={`第 ${i + 1} 条下移`}
                                  title="下移"
                                  disabled={i === cfg.history.items.length - 1}
                                  onClick={() => moveItem(i, 1)}
                                >
                                  ↓
                                </button>
                              </div>
                              <button
                                type="button"
                                className="icon-btn"
                                aria-label={`删除第 ${i + 1} 条`}
                                title="删除这一条"
                                onClick={() =>
                                  patchHistory({ items: cfg.history.items.filter((_, j) => j !== i) })
                                }
                              >
                                ×
                              </button>
                            </div>
                            {badLink ? (
                              <div className="tail-item-warn">
                                不是公众号文章链接，粘贴到公众号后不可点击
                              </div>
                            ) : duplicate ? (
                              <div className="tail-item-warn">
                                这条链接和前面重复，粘贴后会重复推荐
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                    <button className="btn btn-sm mt-2" onClick={addItem}>
                      + 加一条
                    </button>
                    <div className="field-hint">
                      只有公众号文章链接（mp.weixin.qq.com 的 /s/… 地址）会被写成可点击的超链接，
                      粘贴后仍然能点。其他外链微信会在粘贴时剥离，只能改成纯文本、二维码，或放到
                      「阅读原文」。
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
                      aria-label="版权声明正文"
                      value={cfg.copyright.text}
                      onChange={(e) => patchCopyright({ text: e.target.value })}
                      placeholder="© {year} {account} · 转载请注明出处"
                    />
                  </div>
                ) : null}
              </div>

              <div className="field-hint mt-3">
                可用占位符：{TAIL_VARS.join('、')}
              </div>
            </>
          ) : (
            <div className="tail-preview">
              {preview.html ? (
                <div dangerouslySetInnerHTML={{ __html: preview.html }} />
              ) : (
                <div className="check-empty check-empty-md">
                  三块都没启用，文末不会追加任何内容。
                </div>
              )}
              <div className="field-hint mt-4">
                这段 HTML 共 {[...preview.html].length} 字符，会拼在正文和参考链接之后。
                预览用的是当前公众号主题（{theme.name}）的配色。
              </div>
            </div>
          )}
        </div>

    </Modal>
  )
}
