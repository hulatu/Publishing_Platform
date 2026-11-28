/**
 * 公众号主题选择器
 *
 * 缩略图不是画出来的示意图，而是用真实渲染管线（renderHtml）把一段样例
 * 文章渲染出来再缩放——卡片上看到什么，复制到公众号就是什么。
 *
 * 交互：点侧栏的主题按钮 → 弹出「主题墙」，全宽网格排布（窄屏自动降列）。
 * 点一下即时应用，留在墙上继续比，关掉（完成 / Esc / 点遮罩）即可。
 *
 * 缩略图宽度是流式的（网格列宽会变），所以用 ResizeObserver 把真实渲染结果
 * 等比缩到列宽——固定 184px 的老做法会浪费右侧空间。
 */

import { useEffect, useRef, useState } from 'react'
import { renderHtml } from '../core/html-inline'
import type { HtmlTheme } from '../core/html-inline'
import type { Block } from '../core/ir'
import { getWechatTheme, wechatThemes } from '../themes/wechat'
import { Modal } from './Modal'

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
    raw: '这是一句引言，看顶部的强调线。',
    children: [
      { t: 'p', raw: '这是一句引言，看顶部的强调线。', inline: [{ t: 'text', v: '这是一句引言，看顶部的强调线。' }] },
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
  const frameBg = theme.swatch?.bg

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
      aria-label={`${theme.name}，${theme.group}，${theme.hint}`}
      aria-pressed={active}
    >
      <div
        className="theme-frame"
        ref={frameRef}
        aria-hidden="true"
        style={frameBg ? { background: frameBg } : undefined}
      >
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

  // 真实预览不必在导入文章时就渲染：第一次打开主题墙再算。
  const [previews, setPreviews] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    if (!open) return
    setPreviews(new Map(wechatThemes.map((t) => [t.id, previewOf(t)])))
  }, [open])

  return (
    <>
      <div className="theme-bar-wrap">
        <button className="theme-bar" onClick={() => setOpen(true)}>
          <span className="theme-swatches" aria-hidden>
            <span style={{ background: current.swatch?.bg ?? '#fff' }} />
            <span style={{ background: current.swatch?.accent ?? '#c0392b' }} />
            <span style={{ background: current.swatch?.ink ?? '#1b1917' }} />
          </span>
          <span className="theme-bar-current">{current.name}</span>
          <span className="theme-bar-action">更换</span>
        </button>
      </div>

      {open ? (
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          label="选择公众号排版主题"
          shellClass="theme-sheet"
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

        </Modal>
      ) : null}
    </>
  )
}
