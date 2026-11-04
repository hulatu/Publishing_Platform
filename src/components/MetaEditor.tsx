import type { DocMeta } from '../core/ir'

interface Props {
  meta: DocMeta
  onChange: (patch: Partial<DocMeta>) => void
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

export function MetaEditor({ meta, onChange }: Props) {
  return (
    <div className="side-section">
      <div className="side-title">
        <span>文章信息</span>
      </div>

      <div className="field">
        <label className="field-label">标题</label>
        <input
          className="field-input"
          value={meta.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="文章标题"
        />
      </div>

      <div className="field">
        <label className="field-label">分类（多个用顿号或逗号分隔）</label>
        <input
          className="field-input"
          value={toText(meta.categories)}
          onChange={(e) => onChange({ categories: fromText(e.target.value) })}
          placeholder="思考、工具"
        />
      </div>

      <div className="field">
        <label className="field-label">标签</label>
        <input
          className="field-input"
          value={toText(meta.tags)}
          onChange={(e) => onChange({ tags: fromText(e.target.value) })}
          placeholder="写作、效率"
        />
        {meta.tags.length > 0 ? (
          <div className="tag-row">
            {meta.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label">摘要（用于卡片副标题与微博）</label>
        <textarea
          className="field-textarea"
          value={meta.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          placeholder="一两句话概括这篇文章"
        />
      </div>
    </div>
  )
}
