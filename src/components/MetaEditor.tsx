import { useId, useState } from 'react'
import type { DocMeta } from '../core/ir'

interface Props {
  meta: DocMeta
  onChange: (patch: Partial<DocMeta>) => void
  /** 嵌在文章导入区里时不再单独形成一个带分隔线的侧栏区块 */
  embedded?: boolean
}

function toText(arr: string[]): string {
  return arr.join('、')
}

function fromText(text: string): string[] {
  return text
    .split(/[、,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function MetaEditor({ meta, onChange, embedded = false }: Props) {
  /** 默认收起：标题在主区顶部已经能看到，侧栏空间优先给平台导航 */
  const [open, setOpen] = useState(false)
  /** 字段 id：读屏靠 label 的 htmlFor 找到对应输入框，光有视觉标签等于没标签 */
  const fid = useId()

  return (
    <div className={embedded ? 'meta-embed' : 'side-section'}>
      <button className="side-collapse" onClick={() => setOpen((v) => !v)}>
        <span className={`caret ${open ? 'open' : ''}`}>▶</span>
        <span className="side-collapse-title">文章信息</span>
        {embedded ? null : <span className="side-collapse-value">{meta.title || '未命名'}</span>}
        <span className="side-collapse-action">{open ? '收起' : '编辑'}</span>
      </button>

      {open ? (
        <div className="side-collapse-body">
          <div className="field">
            <label className="field-label" htmlFor={`${fid}-title`}>
              标题
            </label>
            {/* 标题可能很长，用 textarea 换行显示，和摘要同一套输入样式 */}
            <textarea
              id={`${fid}-title`}
              className="field-textarea"
              value={meta.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="文章标题"
              rows={2}
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field-label" htmlFor={`${fid}-categories`}>
                分类
              </label>
              <input
                id={`${fid}-categories`}
                className="field-input"
                value={toText(meta.categories)}
                onChange={(e) => onChange({ categories: fromText(e.target.value) })}
                placeholder="思考、工具"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${fid}-tags`}>
                标签
              </label>
              <input
                id={`${fid}-tags`}
                className="field-input"
                value={toText(meta.tags)}
                onChange={(e) => onChange({ tags: fromText(e.target.value) })}
                placeholder="写作、效率"
              />
            </div>
          </div>

          {meta.tags.length > 0 ? (
            <div className="tag-row">
              {meta.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          <div className="field">
            <label className="field-label" htmlFor={`${fid}-summary`}>
              摘要
            </label>
            <textarea
              id={`${fid}-summary`}
              className="field-textarea"
              value={meta.summary}
              onChange={(e) => onChange({ summary: e.target.value })}
              placeholder="一两句话概括这篇文章，用于卡片副标题与微博"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
