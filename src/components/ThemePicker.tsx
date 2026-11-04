/**
 * 公众号主题选择器
 *
 * 缩略图不是画出来的示意图，而是用真实渲染管线（renderHtml）把一段样例
 * 文章渲染出来再缩放——卡片上看到什么，复制到公众号就是什么。
 *
 * 交互：点顶栏 → 弹出「主题墙」，全宽网格排布（窄屏自动降列），
 * 12 款主题在常见屏幕上两行放得下，不用滚。点一下即时应用，留在墙上继续比，
 * 关掉（完成 / Esc / 点遮罩）即可。
 *
 * 缩略图宽度是流式的（网格列宽会变），所以用 ResizeObserver 把真实渲染结果
 * 等比缩到列宽——固定 184px 的老做法会浪费右侧空间。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { renderHtml } from '../core/html-inline'
import type { HtmlTheme } from '../core/html-inline'
import type { Block } from '../core/ir'
import { getWechatTheme, wechatThemes } from '../themes/wechat'

/**
 * 样例：两个二级标题 + 一段带加粗的正文 + 一句引用。
 * 内容要够长——缩略图框是固定比例的，太短会空掉一半，看不出主题的节奏。
 */
const SAMPLE: Block[] = [
  { t: 'heading', level: 2, raw: '第一节的标题', inline: [{ t: 'text', v: '第一节的标题' }] },
  {
    t: 'p',
    raw: '正文里会有加粗强调和行内代码',
    inline: [
      { t: 'text', v: '正文里会有' },
      { t: 'strong', c: [{ t: 'text', v: '加粗强调' }] },
      { t: 'text', v: '和' },
      { t: 'code', v: '行内代码' },
      { t: 'text', v: '，字距与段间距决定读感。' },
    ],
  },
  {
    t: 'quote',
    raw: '这是一句引用，看边框和底色。',
    children: [
      { t: 'p', raw: '这是一句引用，看边框和底色。', inline: [{ t: 'text', v: '这是一句引用，看边框和底色。' }] },
    ],
  },
  { t: 'heading', level: 2, raw: '第二节的标题', inline: [{ t: 'text', v: '第二节的标题' }] },
  {
    t: 'p',
    raw: '再看一段正文，感受行高。',
    inline: [{ t: 'text', v: '再看一段正文，感受行高与段间距是否舒服。' }],
  },
]

/** 样例渲染出来的原始宽度，缩放比以此为准 */
const SAMPLE_WIDTH = 558

function previewOf(theme: HtmlTheme): string {
  return renderHtml(SAMPLE, { theme, linkMode: 'refs', target: 'wechat' }).html
}

interface ThumbProps {
  theme: HtmlTheme
  html: string
  active: boolean
  onSelect: () => void
}

function ThemeThumb({ theme, html, active, onSelect }: ThumbProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.33)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const apply = (w: number) => {
      if (w > 0) setScale(w / SAMPLE_WIDTH)
    }
    apply(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <button
      className={`theme-card ${active ? 'active' : ''}`}
      onClick={onSelect}
      title={`${theme.name} · ${theme.hint}`}
      aria-pressed={active}
    >
      <div className="theme-frame" ref={frameRef}>
        <div
          className="theme-scaled"
          style={{ transform: `scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <div className="theme-meta">
        <div className="theme-name-row">
          <span className="theme-name">{theme.name}</span>
          <span className="theme-tag">{theme.group}</span>
          {active ? <span className="theme-check">✓</span> : null}
        </div>
        <span className="theme-hint">{theme.hint}</span>
      </div>
    </button>
  )
}

interface Props {
  value: string
  onChange: (id: string) => void
}

export function ThemePicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const current = getWechatTheme(value)

  // 主题是静态数据，整张表只渲染一次
  const previews = useMemo(
    () => new Map(wechatThemes.map((t) => [t.id, previewOf(t)])),
    [],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div className="theme-bar-wrap">
        <button className="theme-bar" onClick={() => setOpen(true)}>
          <span className="theme-bar-label">排版主题</span>
          <span className="theme-swatches" aria-hidden>
            <span style={{ background: current.swatch?.bg ?? '#fff' }} />
            <span style={{ background: current.swatch?.accent ?? '#c0392b' }} />
            <span style={{ background: current.swatch?.ink ?? '#1b1917' }} />
          </span>
          <span className="theme-bar-current">{current.name}</span>
          <span className="theme-bar-hint">{current.hint}</span>
          <span className="theme-bar-action">更换 · {wechatThemes.length} 款</span>
        </button>
      </div>

      {open ? (
        <div className="modal-mask" onClick={() => setOpen(false)}>
          <div
            className="theme-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="选择公众号排版主题"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="theme-sheet-head">
              <div>
                <div className="modal-title">排版主题</div>
                <div className="theme-sheet-sub">缩略图是真实渲染结果，点一下即应用</div>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>

            <div className="theme-sheet-body">
              <div className="theme-grid">
                {wechatThemes.map((t) => (
                  <ThemeThumb
                    key={t.id}
                    theme={t}
                    html={previews.get(t.id) ?? ''}
                    active={value === t.id}
                    onSelect={() => onChange(t.id)}
                  />
                ))}
              </div>
            </div>

            <div className="theme-sheet-foot">
              <span className="theme-sheet-current">
                当前：<b>{current.name}</b>
                <span className="muted"> · {current.hint}</span>
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
