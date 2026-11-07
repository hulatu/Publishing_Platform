/**
 * 复盘：发布后的数据
 *
 * 两个页签，对应两个真实动作：
 * - **本篇**：从各平台后台把数字抄进来。所以这一页只追求一件事 —— 填得快。
 *   四个格子横向排、数字键盘、不校验不弹错，敲完就走。
 * - **全部**：过一阵子回头看「哪个平台值得发」。所以这一页只给相对量：
 *   互动率、每篇的阅读、哪家最高。
 *
 * 互动率的分母是阅读，所以阅读没填时显示「—」而不是 0%：
 * 0% 会被读成「发了没人理」，那是完全不同的结论。
 */

import { useState } from 'react'
import { parseNum } from '../core/num'
import { convertPlatforms, rewritePlatforms } from '../renderers'
import { formatAt, type ArticleLedger, type PlatformStats } from '../core/ledger'
import {
  formatNum,
  formatRate,
  hasStats,
  interactionsOf,
  rateOf,
  type ArticleSummary,
} from '../core/review'

interface Props {
  open: boolean
  onClose: () => void
  articleTitle: string
  ledger: ArticleLedger
  /** 跨篇汇总，App 里用 useMemo 算好传进来 */
  summaries: ArticleSummary[]
  onSetStats: (platformId: string, patch: PlatformStats) => void
}

const ALL = [...convertPlatforms, ...rewritePlatforms]
const NAME: Record<string, string> = Object.fromEntries(ALL.map((p) => [p.id, p.name]))

/**
 * 数字输入框。
 *
 * 输入框里显示「用户打的字」，不是「解析后的数」——
 * 完全受控于数字时，打「1.2万」会在打到「1.2」的那一帧被四舍五入成 1、
 * 内容直接被改写，等于根本没法输入带单位的数。失焦时清掉草稿，回到真实值。
 */
function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | undefined
  onChange: (v: number | undefined) => void
}) {
  /**
   * 输入框里显示「用户打的字」，不是「解析后的数」。
   *
   * 完全受控于数字时，打「1.2万」会在打到「1.2」的那一帧被四舍五入成 1、
   * 光标内容直接被改写，等于根本没法输入带单位的数。失焦时清掉草稿，
   * 回到「显示真实值」。
   */
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? (typeof value === 'number' ? String(value) : '')

  return (
    <label className="rev-field">
      <span className="rev-field-label">{label}</span>
      <input
        className="field-input rev-input"
        inputMode="numeric"
        value={text}
        placeholder="—"
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(parseNum(e.target.value))
        }}
        onBlur={() => setDraft(null)}
        spellCheck={false}
      />
    </label>
  )
}

export function ReviewSheet({ open, onClose, articleTitle, ledger, summaries, onSetStats }: Props) {
  const [tab, setTab] = useState<'article' | 'all'>('article')
  if (!open) return null

  const published = Object.entries(ledger).filter(([, rec]) => Boolean(rec))
  const pending = ALL.length - published.length

  // 全篇汇总
  const totalRead = published.reduce((n, [, r]) => n + (r.stats?.read ?? 0), 0)
  const totalInteraction = published.reduce((n, [, r]) => n + interactionsOf(r.stats), 0)
  const filledCount = published.filter(([, r]) => hasStats(r.stats)).length

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal review-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">复盘</div>
            <div className="ledger-sub">
              {tab === 'article'
                ? `《${articleTitle}》· 已发 ${published.length} / ${ALL.length}`
                : `共 ${summaries.length} 篇有数据 · 全部文章按阅读排序`}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="segmented rev-tabs">
          <button className={tab === 'article' ? 'active' : ''} onClick={() => setTab('article')}>
            本篇
          </button>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
            全部 {summaries.length > 0 ? summaries.length : ''}
          </button>
        </div>

        {tab === 'article' ? (
          <>
            <div className="modal-body rev-body">
              {published.length === 0 ? (
                <div className="check-empty" style={{ padding: '36px 0' }}>
                  还没标记任何平台为已发。先在「台账」里标记，再回来填数据 ——
                  没发布过的平台填了阅读量也没有意义。
                </div>
              ) : (
                <>
                  <div className="rev-total">
                    <div className="rev-total-item">
                      <span className="rev-total-label">总阅读</span>
                      <b>{formatNum(totalRead)}</b>
                    </div>
                    <div className="rev-total-item">
                      <span className="rev-total-label">总互动</span>
                      <b>{formatNum(totalInteraction)}</b>
                    </div>
                    <div className="rev-total-item">
                      <span className="rev-total-label">互动率</span>
                      <b>{formatRate(totalRead > 0 ? totalInteraction / totalRead : null)}</b>
                    </div>
                    <div className="rev-total-item">
                      <span className="rev-total-label">已填</span>
                      <b>
                        {filledCount}/{published.length}
                      </b>
                    </div>
                  </div>

                  {published.map(([id, rec]) => {
                    const rate = rateOf(rec.stats)
                    return (
                      <div className="rev-row" key={id}>
                        <div className="rev-row-head">
                          <span className="rev-name">{NAME[id] ?? id}</span>
                          <span className="rev-at">{formatAt(rec.at)}</span>
                          <span className={`rev-rate ${rate === null ? 'empty' : ''}`}>
                            互动率 {formatRate(rate)}
                          </span>
                        </div>
                        <div className="rev-fields">
                          <NumField
                            label="阅读"
                            value={rec.stats?.read}
                            onChange={(v) => onSetStats(id, { read: v })}
                          />
                          <NumField
                            label="点赞"
                            value={rec.stats?.like}
                            onChange={(v) => onSetStats(id, { like: v })}
                          />
                          <NumField
                            label="评论"
                            value={rec.stats?.comment}
                            onChange={(v) => onSetStats(id, { comment: v })}
                          />
                          <NumField
                            label="收藏"
                            value={rec.stats?.fav}
                            onChange={(v) => onSetStats(id, { fav: v })}
                          />
                        </div>
                      </div>
                    )
                  })}
                </>
              )}

              {pending > 0 && published.length > 0 ? (
                <div className="field-hint" style={{ marginTop: 12 }}>
                  还有 {pending} 个平台没标记发布，标记后才会出现在这里。
                </div>
              ) : null}
            </div>

            <div className="modal-foot">
              <span className="muted" style={{ fontSize: 11 }}>
                数据全部存在本机浏览器，不会上传
              </span>
              <button className="btn btn-primary btn-sm" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body rev-body">
              {summaries.length === 0 ? (
                <div className="check-empty" style={{ padding: '36px 0' }}>
                  还没有任何一篇填过数据。切到「本篇」抄几个数字进来，这里就会出现对比。
                </div>
              ) : (
                <>
                  <div className="rev-total">
                    <div className="rev-total-item">
                      <span className="rev-total-label">总阅读</span>
                      <b>{formatNum(summaries.reduce((n, s) => n + s.read, 0))}</b>
                    </div>
                    <div className="rev-total-item">
                      <span className="rev-total-label">总互动</span>
                      <b>{formatNum(summaries.reduce((n, s) => n + s.interaction, 0))}</b>
                    </div>
                    <div className="rev-total-item">
                      <span className="rev-total-label">整体互动率</span>
                      <b>
                        {formatRate(
                          (() => {
                            const r = summaries.reduce((n, s) => n + s.read, 0)
                            return r > 0
                              ? summaries.reduce((n, s) => n + s.interaction, 0) / r
                              : null
                          })(),
                        )}
                      </b>
                    </div>
                    <div className="rev-total-item">
                      <span className="rev-total-label">最高单篇</span>
                      <b>{formatNum(summaries[0]?.read)}</b>
                    </div>
                  </div>

                  <div className="rev-table">
                    <div className="rev-thead">
                      <span>文章</span>
                      <span className="num">阅读</span>
                      <span className="num">互动</span>
                      <span className="num">互动率</span>
                      <span>最高平台</span>
                    </div>
                    {summaries.map((s) => (
                      <div className="rev-trow" key={s.key}>
                        <span className="rev-tcell-title" title={s.title}>
                          {s.title}
                        </span>
                        <span className="num">{formatNum(s.read)}</span>
                        <span className="num">{formatNum(s.interaction)}</span>
                        <span className="num">{formatRate(s.rate)}</span>
                        <span className="rev-top">
                          {s.top ? `${NAME[s.top.platformId] ?? s.top.platformId} ${formatNum(s.top.read)}` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="modal-foot">
              <span className="muted" style={{ fontSize: 11 }}>
                一篇填了多个平台时，阅读按平台累加
              </span>
              <button className="btn btn-primary btn-sm" onClick={onClose}>
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
