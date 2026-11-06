/**
 * 标题与标签
 *
 * 一次生成 8 个标题 + 一组标签。标题按「角度」标注，是为了让用户扫一眼就知道
 * 这 8 条不是同一句话的八种换词；字数与「≤20 字」标记是硬信息，小红书能不能用
 * 全看这个数字。
 *
 * 标签默认只勾上「原文里已经有的」，避免用户点一下「应用」就把自己的标签体系
 * 冲成模型给的那套。
 */

import { useEffect, useMemo, useState } from 'react'
import { charCount } from '../core/cjk'
import { LIMITS, type MetaLabState, type TitleCandidate } from '../ai/types'
import { styleLabel } from '../ai/meta-lab'
import { useElapsed } from './useElapsed'
import { formatElapsed } from '../core/time'

interface Props {
  open: boolean
  onClose: () => void
  state: MetaLabState
  /** 当前文章标题（用来标出「当前」） */
  currentTitle: string
  /** 当前 front matter 里的标签 */
  currentTags: string[]
  onRun: () => void
  onCancel: () => void
  onApplyTitle: (title: string) => void
  onApplyTags: (tags: string[]) => void
  onCopy: (text: string, label: string) => void
  providerReady: boolean
  onOpenSettings: () => void
}

export function MetaLab({
  open,
  onClose,
  state,
  currentTitle,
  currentTags,
  onRun,
  onCancel,
  onApplyTitle,
  onApplyTags,
  onCopy,
  providerReady,
  onOpenSettings,
}: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const tags = state.result?.tags ?? []
  const titles = state.result?.titles ?? []

  // 每次出结果后，默认勾上「原文里已经有」的标签
  const tagKey = tags.map((t) => t.name).join('\u0001')
  useEffect(() => {
    const have = new Set(currentTags.map((t) => t.trim()))
    setPicked(new Set(tags.filter((t) => have.has(t.name)).map((t) => t.name)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagKey])

  const pickedList = useMemo(() => tags.filter((t) => picked.has(t.name)).map((t) => t.name), [tags, picked])
  const shortOnes = titles.filter((t) => charCount(t.text) <= LIMITS.titleShort).length
  const running = state.status === 'running'
  const elapsed = useElapsed(running)

  if (!open) return null

  const toggle = (name: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const titleRow = (t: TitleCandidate, i: number) => {
    const n = charCount(t.text)
    const isCurrent = t.text.trim() === currentTitle.trim()
    return (
      <div className="meta-title" key={`${t.text}-${i}`}>
        <span className="meta-idx">{String(i + 1).padStart(2, '0')}</span>
        <div className="meta-title-body">
          <div className="meta-title-text">{t.text}</div>
          <div className="meta-title-meta">
            <span className="meta-angle">{styleLabel(t.style)}</span>
            <span className={n <= LIMITS.titleShort ? 'meta-len ok' : 'meta-len'}>{n} 字</span>
            {n <= LIMITS.titleShort ? <span className="meta-badge">≤{LIMITS.titleShort} 字</span> : null}
            {isCurrent ? <span className="meta-current">当前标题</span> : null}
            {t.note ? <span className="meta-note">{t.note}</span> : null}
          </div>
        </div>
        <div className="meta-actions">
          <button className="btn btn-sm btn-quiet" onClick={() => onCopy(t.text, '标题')}>
            复制
          </button>
          <button className="btn btn-sm" onClick={() => onApplyTitle(t.text)} disabled={isCurrent}>
            用作标题
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal meta-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">标题与标签</div>
            <div className="ledger-sub">
              {titles.length > 0
                ? `${titles.length} 个候选 · ${shortOnes} 条在 ${LIMITS.titleShort} 字内（可直接发小红书）`
                : `最多 ${LIMITS.titleCount} 个不同角度，至少 ${LIMITS.titleMinShort} 条在 ${LIMITS.titleShort} 字内`}
              {state.providerLabel ? ` · ${state.providerLabel}` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          {!providerReady ? (
            <div className="notice notice-warn" style={{ marginBottom: 14 }}>
              <span className="notice-mark">!</span>
              <span>
                还没填 API Key，只能用本地拼装（只重排原文已有的字句，不新增事实）。
                <button className="link-btn" onClick={onOpenSettings}>
                  去填 Key
                </button>
              </span>
            </div>
          ) : null}

          {/* 没配 Key 时上面那条已经说清楚了，这里再报一遍「未配置大模型」只是噪音 */}
          {state.error && providerReady ? (
            <div className="notice notice-warn" style={{ marginBottom: 14 }}>
              <span className="notice-mark">!</span>
              <span>{state.error}</span>
            </div>
          ) : null}

          {running ? (
            <div className="meta-running">
              <span className="spinner" />
              <span>
                正在想标题…
                {state.streaming ? `已生成 ${charCount(state.streaming)} 字符` : ''}
              </span>
              <span className="ai-elapsed">{formatElapsed(elapsed)}</span>
              <button className="btn btn-sm" onClick={onCancel}>
                停止
              </button>
            </div>
          ) : null}

          {!running && titles.length === 0 ? (
            <div className="check-empty" style={{ padding: '36px 0' }}>
              还没有候选。点右下角「生成 8 个标题」开始。
            </div>
          ) : null}

          {titles.length > 0 ? (
            <>
              <div className="meta-section-head">
                <span>标题候选</span>
                <span className="meta-section-hint">
                  {titles.length} 条 · 其中 {shortOnes} 条可直接用于小红书
                </span>
              </div>
              <div className="meta-titles">{titles.map(titleRow)}</div>
            </>
          ) : null}

          {tags.length > 0 ? (
            <>
              <div className="meta-section-head" style={{ marginTop: 22 }}>
                <span>标签建议</span>
                <span className="meta-section-hint">点选后写进 front matter，已选 {pickedList.length} 个</span>
              </div>
              <div className="meta-tags">
                {tags.map((t) => (
                  <button
                    key={t.name}
                    className={`meta-tag ${picked.has(t.name) ? 'on' : ''}`}
                    onClick={() => toggle(t.name)}
                    title={t.why}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm"
                  disabled={pickedList.length === 0}
                  onClick={() => onCopy(pickedList.map((t) => `#${t}`).join(' '), '标签')}
                >
                  复制为话题（#a #b）
                </button>
                <button
                  className="btn btn-sm"
                  disabled={pickedList.length === 0}
                  onClick={() => onApplyTags(pickedList)}
                >
                  写入 front matter 标签
                </button>
                <button
                  className="btn btn-sm btn-quiet"
                  disabled={pickedList.length === 0}
                  onClick={() => onCopy(pickedList.join('、'), '标签')}
                >
                  复制为顿号分隔
                </button>
              </div>
            </>
          ) : null}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm" onClick={onClose}>
            关闭
          </button>
          <button className="btn btn-primary btn-sm" onClick={onRun} disabled={running}>
            {running ? <span className="spinner dark" /> : null}
            {running ? '生成中…' : titles.length > 0 ? '换一批' : `生成 ${LIMITS.titleCount} 个标题`}
          </button>
        </div>
      </div>
    </div>
  )
}
