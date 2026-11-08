import { useEffect, useMemo, useRef, useState } from 'react'
import type { Doc } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import { buildCards, DEFAULT_SITE_NAME, makeCard, type SectionSummary } from '../cards/build'
import { CardRenderer } from '../cards/templates'
import { cardThemes, getCardTheme } from '../cards/themes'
import {
  cardFileName,
  cardNo,
  exportCardsAsZip,
  readPngSize,
  renderCardToBlob,
  downloadBlob,
  safeFileName,
  type ZipEntry,
} from '../cards/export'
import {
  CARD_FORMATS,
  getCardFormat,
  layoutNames,
  type CardFormatId,
  type CardLayout,
  type CardSpec,
} from '../cards/types'

interface Props {
  doc: Doc
  /** splitSections() 的结果，决定出几张「小节卡」 */
  sections: ArticleSection[]
  /** AI 生成的章节摘要（用户已校对过的版本），优先于本地兜底 */
  summaries: SectionSummary[] | null
  cardThemeId: string
  onThemeChange: (id: string) => void
  siteName: string
  onSiteNameChange: (name: string) => void
  onToast: (text: string, kind?: 'info' | 'success' | 'error') => void
}

/** 预览框的最大占位，实际缩放按比例算 */
const PREVIEW_BOX = { w: 360, h: 400 }

const ADDABLE: CardLayout[] = ['quote', 'points', 'section', 'cover', 'end']

/**
 * 重排/增删之后页码会错位（把第 4 张拖到第 1 位，它头上还挂着 04 / 08），
 * 所以每次结构变化都按新顺序重算一遍。
 * 页码和导出文件名里的编号共用 cardNo()，两处永远是同一个数。
 */
function renumber(list: CardSpec[]): CardSpec[] {
  const total = list.length
  return list.map((c, i) => ({ ...c, mark: `${cardNo(i + 1)} / ${cardNo(total)}` }))
}

export function CardStudio({
  doc,
  sections,
  summaries,
  cardThemeId,
  onThemeChange,
  siteName,
  onSiteNameChange,
  onToast,
}: Props) {
  const [cards, setCards] = useState<CardSpec[]>(() =>
    renumber(buildCards({ doc, themeId: cardThemeId, siteName, sections, summaries })),
  )
  const [selectedId, setSelectedId] = useState('cover')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [format, setFormat] = useState<CardFormatId>('3:4')
  const [multiSize, setMultiSize] = useState(false)

  // 拖拽排序
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  // 用户改过任何一张卡之后，就不再用新摘要覆盖他的编辑
  const dirty = useRef(false)

  // 导出的节点引用：离屏渲染完整尺寸，避免被预览缩放影响
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const rebuild = () => {
    const next = buildCards({ doc, themeId: cardThemeId, siteName, sections, summaries })
    setCards(renumber(next))
    setSelectedId(next[0]?.id ?? 'cover')
    dirty.current = false
  }

  // 只在「换了一篇文章」时重建卡片。
  // 不能依赖 doc 对象本身 —— App 里改标题/摘要会产生新的 doc 对象，
  // 那样每次改元信息都会把用户在卡片上改过的文字冲掉。
  // rawMd 只在重新导入文件时变化，正是我们想要的信号。
  const articleKey = doc.rawMd
  useEffect(() => {
    rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleKey])

  // 摘要刚生成出来（或用户改了某节摘要）→ 小节卡的正文跟着升级。
  // 但只在用户还没动过卡片时自动同步，否则会把手工改过的字冲掉。
  const digestKey = useMemo(
    () => (summaries ?? []).map((s) => `${s.index}:${s.summary}`).join('\u0001'),
    [summaries],
  )
  useEffect(() => {
    if (!dirty.current) rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digestKey])

  // 主题/署名变化时同步到所有卡片
  useEffect(() => {
    setCards((prev) => prev.map((c) => ({ ...c, themeId: cardThemeId, footer: siteName })))
  }, [cardThemeId, siteName])

  const selected = useMemo(() => cards.find((c) => c.id === selectedId) ?? cards[0], [cards, selectedId])
  const theme = getCardTheme(selected?.themeId ?? cardThemeId)
  const fmt = getCardFormat(format)
  const previewScale = Math.min(PREVIEW_BOX.w / fmt.w, PREVIEW_BOX.h / fmt.h)

  const patch = (id: string, changes: Partial<CardSpec>) => {
    dirty.current = true
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)))
  }

  const addCard = (layout: CardLayout) => {
    const id = `custom-${Date.now()}`
    const spec = { ...makeCard(doc, layout, cardThemeId, siteName), id }
    setCards((prev) => renumber([...prev, spec]))
    setSelectedId(id)
    setAddOpen(false)
    dirty.current = true
  }

  const removeCard = (id: string) => {
    dirty.current = true
    setCards((prev) => {
      const next = renumber(prev.filter((c) => c.id !== id))
      if (selectedId === id) setSelectedId(next[0]?.id ?? '')
      return next
    })
  }

  /** 把 from 拖到 to 的位置（to 之后紧邻 to） */
  const moveCard = (from: string, to: string) => {
    setCards((prev) => {
      const a = prev.findIndex((c) => c.id === from)
      const b = prev.findIndex((c) => c.id === to)
      if (a < 0 || b < 0 || a === b) return prev
      const next = [...prev]
      const [item] = next.splice(a, 1)
      next.splice(b, 0, item)
      return renumber(next)
    })
    dirty.current = true
  }

  const fileNameOf = (c: CardSpec, index: number) => cardFileName(c, index, doc.meta.title)

  const exportOne = async () => {
    if (!selected) return
    const node = nodeRefs.current[`${selected.id}@${format}`]
    if (!node) {
      onToast('渲染节点还没准备好，请稍后重试', 'error')
      return
    }
    setExporting(true)
    try {
      const blob = await renderCardToBlob(node, { backgroundColor: theme.bg, format })
      // 提示里的数字读真实像素，而不是按配置推算 —— 这样尺寸不对时不会骗人
      const px = await readPngSize(blob)
      // 单张导出会落到「下载」里和别的图混在一起，所以带上比例
      const base = fileNameOf(selected, Math.max(0, cards.findIndex((c) => c.id === selected.id)))
      downloadBlob(blob, `${base}-${format.replace(':', 'x')}.png`)
      onToast(`已导出 ${px ? `${px.w}×${px.h}` : `${fmt.w * 2}×${fmt.h * 2}`} PNG`, 'success')
    } catch (e) {
      onToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const exportAll = async () => {
    const formats = multiSize ? CARD_FORMATS : [fmt]

    // 编号本身就是唯一键（01..NN），不会重名，不需要再按出现次数加后缀 ——
    // 那个 `-2` 后缀反而会把 10 排到 2 后面去
    const entries: ZipEntry[] = []
    cards.forEach((c, i) => {
      const name = `${fileNameOf(c, i)}.png`
      for (const f of formats) {
        const node = nodeRefs.current[`${c.id}@${f.id}`]
        if (node) entries.push({ node, name, format: f.id, folder: multiSize ? f.id.replace(':', 'x') : undefined })
      }
    })

    if (entries.length === 0) {
      onToast('没有可导出的卡片', 'error')
      return
    }

    setExporting(true)
    setProgress('')
    try {
      const res = await exportCardsAsZip(
        entries,
        `${safeFileName(doc.meta.title)}-配图.zip`,
        { backgroundColor: theme.bg },
        (done, total) => setProgress(`${done}/${total}`),
      )
      if (res.failed > 0) {
        // 有失败也要把成功的那批交出去，同时说清少了几张
        onToast(`已导出 ${res.ok} 张，${res.failed} 张渲染失败被跳过`, 'info')
      } else {
        onToast(`已导出 ${res.ok} 张图`, 'success')
      }
    } catch (e) {
      onToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setExporting(false)
      setProgress('')
    }
  }

  return (
    <div className="studio">
      {/* ---------- 预览 ---------- */}
      <div className="studio-canvas">
        <div
          style={{
            width: fmt.w * previewScale,
            height: fmt.h * previewScale,
            overflow: 'hidden',
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>
            {selected ? <CardRenderer spec={selected} theme={theme} format={format} /> : null}
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center' }}>
          {fmt.w * 2} × {fmt.h * 2} · {fmt.hint}
        </div>
      </div>

      {/* ---------- 控制面板 ---------- */}
      <div className="studio-panel">
        <div className="side-title">
          <span>卡片</span>
          <span className="count">{cards.length} 张 · 可拖动排序</span>
        </div>

        <div className="card-list">
          {cards.map((c) => {
            const t = getCardTheme(c.themeId)
            const active = c.id === selectedId
            return (
              <button
                key={c.id}
                draggable
                className={[
                  'card-item',
                  active ? 'active' : '',
                  dragId === c.id ? 'dragging' : '',
                  overId === c.id && dragId && dragId !== c.id ? 'drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedId(c.id)}
                onDragStart={(e) => {
                  setDragId(c.id)
                  e.dataTransfer.effectAllowed = 'move'
                  // Firefox 必须 setData 才会真正开始拖拽
                  e.dataTransfer.setData('text/plain', c.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setOverId(null)
                }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overId !== c.id) setOverId(c.id)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = e.dataTransfer.getData('text/plain') || dragId
                  if (from && from !== c.id) moveCard(from, c.id)
                  setDragId(null)
                  setOverId(null)
                }}
              >
                <span className="card-grip" aria-hidden>
                  ⋮⋮
                </span>
                {/* 缩略图只表示配色，不塞文字 —— 34px 宽放字必然糊成一团 */}
                <div className="card-thumb" style={{ background: t.bg, borderColor: t.line, color: t.ink }}>
                  <span className="card-thumb-bar" style={{ background: t.accent }} />
                  <span className="card-thumb-lines" />
                </div>
                <div className="card-item-body">
                  <div className="card-item-title">
                    {layoutNames[c.layout]}
                    {c.id.startsWith('custom') ? '（新增）' : ''}
                    <span className="card-item-mark">{c.mark}</span>
                  </div>
                  <div className="card-item-sub">{c.title.slice(0, 26)}</div>
                </div>
                {c.id.startsWith('custom') ? (
                  <span
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeCard(c.id)
                    }}
                    title="删除这张卡"
                  >
                    ×
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <div className="add-wrap">
            <button className="btn btn-sm" onClick={() => setAddOpen((v) => !v)}>
              + 加一张卡
            </button>
            {addOpen ? (
              <div className="add-menu" onMouseLeave={() => setAddOpen(false)}>
                {ADDABLE.map((l) => (
                  <button key={l} onClick={() => addCard(l)}>
                    {layoutNames[l]}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="btn btn-sm" onClick={rebuild}>
            重新生成
          </button>
        </div>

        {/* 尺寸 */}
        <div className="field">
          <label className="field-label">导出尺寸</label>
          <div className="segmented fmt-switch">
            {CARD_FORMATS.map((f) => (
              <button
                key={f.id}
                className={format === f.id ? 'active' : ''}
                onClick={() => setFormat(f.id)}
                title={f.hint}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="check-row" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={multiSize} onChange={(e) => setMultiSize(e.target.checked)} />
            <span>导出时三种尺寸各出一套（zip 内按 3x4 / 1x1 / 16x9 分文件夹）</span>
          </label>
        </div>

        {/* 配色 */}
        <div className="field">
          <label className="field-label">配色</label>
          <div className="theme-row">
            {cardThemes.map((t) => (
              <button
                key={t.id}
                className={`theme-chip ${cardThemeId === t.id ? 'active' : ''}`}
                onClick={() => onThemeChange(t.id)}
              >
                <span className="theme-swatch" style={{ background: t.bg, borderColor: t.line }} />
                <span
                  className="theme-swatch"
                  style={{ background: t.accent, borderColor: 'transparent', marginLeft: -4 }}
                />
                {t.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">署名（卡片底部）</label>
          <input
            className="field-input"
            value={siteName}
            onChange={(e) => onSiteNameChange(e.target.value)}
            placeholder={DEFAULT_SITE_NAME}
          />
        </div>

        {/* 编辑当前卡 */}
        {selected ? (
          <>
            <div className="field">
              <label className="field-label">
                主文字
                {selected.layout === 'cover'
                  ? '（标题）'
                  : selected.layout === 'points'
                    ? '（小标题）'
                    : selected.layout === 'section'
                      ? '（小节标题）'
                      : ''}
              </label>
              <textarea
                className="field-textarea"
                value={selected.title}
                onChange={(e) => patch(selected.id, { title: e.target.value })}
              />
            </div>

            {selected.layout === 'points' ? (
              <div className="field">
                <label className="field-label">要点（每行一条，最多 5 条生效）</label>
                <textarea
                  className="field-textarea"
                  style={{ minHeight: 110 }}
                  value={(selected.points ?? []).join('\n')}
                  onChange={(e) =>
                    patch(selected.id, {
                      points: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </div>
            ) : (
              <div className="field">
                <label className="field-label">
                  {selected.layout === 'section' ? '本节内容（摘要）' : '副文字'}
                </label>
                <textarea
                  className="field-textarea"
                  style={selected.layout === 'section' ? { minHeight: 96 } : undefined}
                  value={selected.subtitle ?? ''}
                  onChange={(e) => patch(selected.id, { subtitle: e.target.value })}
                />
                {selected.layout === 'section' ? (
                  <div className="field-hint">
                    约 {(selected.subtitle ?? '').length} 字 · 超过 118 字会顶到画布外，建议压到两三句
                  </div>
                ) : null}
              </div>
            )}

            {selected.layout !== 'end' ? (
              <div className="field">
                <label className="field-label">左上角小标签</label>
                <input
                  className="field-input"
                  value={selected.kicker ?? ''}
                  onChange={(e) => patch(selected.id, { kicker: e.target.value })}
                  placeholder="分类，留空则不显示"
                />
              </div>
            ) : null}

            <div className="field">
              <label className="field-label">底部日期</label>
              <input
                className="field-input"
                value={selected.date ?? ''}
                onChange={(e) => patch(selected.id, { date: e.target.value })}
                placeholder="2026.11.03"
              />
            </div>
          </>
        ) : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-accent" onClick={exportOne} disabled={exporting || !selected}>
            {exporting ? <span className="spinner" /> : null}
            导出这张
          </button>
          <button className="btn" onClick={exportAll} disabled={exporting}>
            {progress
              ? `导出中 ${progress}`
              : multiSize
                ? `导出全部（${cards.length * CARD_FORMATS.length} 张 zip）`
                : `导出全部（${cards.length} 张 zip）`}
          </button>
        </div>

        <div className="notice notice-info" style={{ marginTop: 14 }}>
          <span className="notice-mark">i</span>
          <span>
            导出的文件名带两位编号（<b>01-标题-封面.png</b>），按名称排序就是卡片顺序，
            多选上传不用自己排。卡片是纯 CSS 渲染，不引用文章配图 —— 这样导出不会因为外链图跨域而失败。
            导出用的是系统字体，在 macOS 上最准；换到 Windows 会回退到微软雅黑，长标题的换行位置可能略有偏移。
          </span>
        </div>
      </div>

      {/* ---------- 离屏渲染层：导出用 ---------- */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          left: -20000,
          top: 0,
          pointerEvents: 'none',
        }}
      >
        {CARD_FORMATS.map((f) =>
          cards.map((c) => (
            <div
              key={`${c.id}@${f.id}`}
              ref={(el) => {
                nodeRefs.current[`${c.id}@${f.id}`] = el
              }}
              // 尺寸必须写死。这个容器是 shrink-to-fit 的，宽度由最宽的卡（16:9 的 960）
              // 决定，不写 width 的话每张卡的父节点都是 960 宽，导出就按 960 算。
              style={{ width: f.w, height: f.h }}
            >
              <CardRenderer spec={c} theme={getCardTheme(c.themeId)} format={f.id} />
            </div>
          )),
        )}
      </div>
    </div>
  )
}
