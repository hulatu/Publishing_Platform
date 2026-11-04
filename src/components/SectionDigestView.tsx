/**
 * 逐节摘要面板
 *
 * 这是整个改写链路的「中间产物」，也是用户唯一能核对的地方：
 * 每个 ## 标题对应一条 1–2 句摘要，可逐条改。改完再生成平台文案，
 * 出来的东西就是可控的 —— 而不是模型自由发挥。
 */

import { useState } from 'react'
import type { ArticleSection } from '../core/sections'
import { charCount } from '../core/cjk'
import { LIMITS, type DigestState } from '../ai/types'

interface Props {
  sections: ArticleSection[]
  digest: DigestState
  providerReady: boolean
  onEditSummary: (index: number, summary: string) => void
  onEditOneLiner: (oneLiner: string) => void
  onRegenerate: () => void
  onCancel: () => void
}

function LenHint({ value }: { value: number }) {
  const level = value === 0 ? 'over' : value < LIMITS.digestMin ? 'over' : value > LIMITS.digestMax ? 'over' : ''
  return (
    <span className={`thread-len ${level}`}>
      {value} 字 / {LIMITS.digestMin}–{LIMITS.digestMax}
    </span>
  )
}

export function SectionDigestView({
  sections,
  digest,
  providerReady,
  onEditSummary,
  onEditOneLiner,
  onRegenerate,
  onCancel,
}: Props) {
  const [open, setOpen] = useState(true)

  const running = digest.status === 'running'
  const data = digest.digest
  const missing = data ? data.sections.filter((s) => !s.summary).length : sections.length
  const doneCount = data ? data.sections.length - missing : 0

  return (
    <div className="digest-block">
      <div className="digest-bar">
        <button className="digest-toggle" onClick={() => setOpen((v) => !v)}>
          <span className={`caret ${open ? 'open' : ''}`}>▸</span>
          <span className="digest-bar-title">逐节摘要</span>
          <span className="digest-bar-count">
            {running
              ? `生成中 ${doneCount}/${sections.length}`
              : data
                ? `${doneCount}/${sections.length} 节`
                : `${sections.length} 节`}
          </span>
        </button>

        <div className="digest-bar-actions">
          {running ? (
            <button className="btn btn-sm" onClick={onCancel}>
              停止
            </button>
          ) : (
            <button className="btn btn-sm" onClick={onRegenerate}>
              {data ? '重新摘要' : providerReady ? '生成摘要' : '本地抽取摘要'}
            </button>
          )}
        </div>
      </div>

      {open ? (
        <div className="digest-body">
          {digest.error && providerReady ? (
            <div className="notice notice-warn">
              <span className="notice-mark">!</span>
              <span>{digest.error}</span>
            </div>
          ) : null}

          {running && digest.streaming ? (
            <div className="digest-stream mono">{digest.streaming.slice(-600)}</div>
          ) : null}

          {data ? (
            <>
              <div className="digest-oneliner">
                <label className="field-label">全篇一句话（用于微博正文与各平台开场）</label>
                <input
                  className="field-input"
                  value={data.oneLiner}
                  onChange={(e) => onEditOneLiner(e.target.value)}
                  placeholder="这篇文章做了什么，得到什么结论"
                />
                <div className="digest-oneliner-foot">
                  <span className="muted">直接改这里，平台文案会跟着变</span>
                  <span className={`thread-len ${charCount(data.oneLiner) > LIMITS.oneLinerMax ? 'over' : ''}`}>
                    {charCount(data.oneLiner)} / {LIMITS.oneLinerMax}
                  </span>
                </div>
              </div>

              <div className="digest-list">
                {data.sections.map((s) => {
                  const section = sections.find((x) => x.index === s.index)
                  return (
                    <div key={s.index} className="digest-item">
                      <div className="digest-head">
                        <span className="digest-num">{String(s.index).padStart(2, '0')}</span>
                        <span className="digest-title">{s.heading}</span>
                        <span className="digest-src">
                          {section ? `原文 ${section.chars} 字` : ''}
                          {section?.merged ? ' · 含合并小节' : ''}
                        </span>
                      </div>
                      <textarea
                        className="field-textarea digest-input"
                        value={s.summary}
                        rows={Math.max(2, Math.ceil(charCount(s.summary) / 32) + (charCount(s.summary) > 64 ? 1 : 0))}
                        onChange={(e) => onEditSummary(s.index, e.target.value)}
                        placeholder="这一节说了什么？用什么方法/数字/例子支撑？"
                      />
                      <div className="digest-item-foot">
                        <LenHint value={charCount(s.summary)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          ) : !running ? (
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
              还没有摘要。点右上角按钮，会按 ## 把文章切成 {sections.length} 节，
              每节压成 1–2 句话。之后的平台文案就从这些句子组装。
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
