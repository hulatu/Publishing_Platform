/**
 * 公众号主题选择器
 *
 * 缩略图不是画出来的示意图，而是用真实渲染管线（renderHtml）把一段样例
 * 文章渲染出来再缩放——卡片上看到什么，复制到公众号就是什么。
 *
 * 默认收起：12 款主题全展开要占掉大半屏，会把正文预览挤没。
 */

import { useMemo, useState } from 'react'
import { renderHtml } from '../core/html-inline'
import type { HtmlTheme } from '../core/html-inline'
import type { Block } from '../core/ir'
import { getWechatTheme, themeGroups, wechatThemes } from '../themes/wechat'

/**
 * 样例：两个二级标题 + 一段带加粗的正文 + 一句引用。
 * 内容要够长——缩略图框是固定高度的，太短会空掉一半，看不出主题的节奏。
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

function previewOf(theme: HtmlTheme): string {
  return renderHtml(SAMPLE, { theme, linkMode: 'refs', target: 'wechat' }).html
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
    () => new Map(themeGroups.flatMap((g) => g.themes).map((t) => [t.id, previewOf(t)])),
    [],
  )

  return (
    <div className="theme-bar-wrap">
      <button className="theme-bar" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="theme-bar-label">排版主题</span>
        <span className="theme-bar-current">{current.name}</span>
        <span className="theme-bar-hint">{current.hint}</span>
        <span className="theme-bar-action">
          {open ? '收起' : `更换 · ${wechatThemes.length} 款`}
        </span>
      </button>

      {open ? (
        <div className="theme-picker">
          {themeGroups.map((group) => (
            <div className="theme-group" key={group.name}>
              <div className="theme-group-label">{group.name}</div>
              <div className="theme-row">
                {group.themes.map((t) => (
                  <button
                    key={t.id}
                    className={`theme-card ${value === t.id ? 'active' : ''}`}
                    onClick={() => onChange(t.id)}
                    title={t.hint}
                  >
                    <div className="theme-frame">
                      <div
                        className="theme-scaled"
                        dangerouslySetInnerHTML={{ __html: previews.get(t.id) ?? '' }}
                      />
                    </div>
                    <div className="theme-meta">
                      <span className="theme-name">{t.name}</span>
                      <span className="theme-hint">{t.hint}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
