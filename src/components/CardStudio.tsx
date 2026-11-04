import { useEffect, useMemo, useRef, useState } from 'react'
import type { Doc } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import { buildCards, DEFAULT_SITE_NAME, makeCard, type SectionSummary } from '../cards/build'
import { CardRenderer } from '../cards/templates'
import { cardThemes, getCardTheme } from '../cards/themes'
import { exportCardsAsZip, renderCardToBlob, downloadBlob, safeFileName } from '../cards/export'
import { CARD_HEIGHT, CARD_WIDTH, layoutNames, type CardLayout, type CardSpec } from '../cards/types'

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

const PREVIEW_SCALE = 0.72

const ADDABLE: CardLayout[] = ['quote', 'points', 'section', 'cover', 'end']

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
    buildCards({ doc, themeId: cardThemeId, siteName, sections, summaries }),
  )
  const [selectedId, setSelectedId] = useState('cover')
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState('')
  const [addOpen, setAddOpen] = useState(false)

  // 用户改过任何一张卡之后，就不再用新摘要覆盖他的编辑
  const dirty = useRef(false)

  // 导出的节点引用：离屏渲染完整尺寸，避免被预览缩放影响
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const rebuild = () => {
    const next = buildCards({ doc, themeId: cardThemeId, siteName, sections, summaries })
    setCards(next)
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

  const patch = (id: string, changes: Partial<CardSpec>) => {
    dirty.current = true
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)))
  }

  const addCard = (layout: CardLayout) => {
    const id = `custom-${Date.now()}`
    const spec = { ...makeCard(doc, layout, cardThemeId, siteName), id }
    setCards((prev) => [...prev, spec])
    setSelectedId(id)
    setAddOpen(false)
    dirty.current = true
  }

  const removeCard = (id: string) => {
    dirty.current = true
    setCards((prev) => {
      const next = prev.filter((c) => c.id !== id)
      if (selectedId === id) setSelectedId(next[0]?.id ?? '')
      return next
    })
  }

  const fileNameOf = (c: CardSpec) => {
    const head = safeFileName(doc.meta.title)
    // 小节卡用小节标题命名，导出后一眼能对上是哪一节
    const tail = c.layout === 'section' ? safeFileName(c.title) : layoutNames[c.layout]
    return `${head}-${tail}`
  }

  const exportOne = async () => {
    if (!selected) return
    const node = nodeRefs.current[selected.id]
    if (!node) {
      onToast('渲染节点还没准备好，请稍后重试', 'error')
      return
    }
    setExporting(true)
    try {
      const blob = await renderCardToBlob(node, { backgroundColor: theme.bg })
      downloadBlob(blob, `${fileNameOf(selected)}.png`)
      onToast('已导出 1080×1440 PNG', 'success')
    } catch (e) {
      onToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const exportAll = async () => {
    // 同版式的自定义卡会重名，zip 里后一张会覆盖前一张，所以按出现次数加后缀
    const used = new Map<string, number>()
    const entries = cards
      .map((c) => {
        const node = nodeRefs.current[c.id]
        if (!node) return null
        const base = fileNameOf(c)
        const n = (used.get(base) ?? 0) + 1
        used.set(base, n)
        return { node, name: n === 1 ? `${base}.png` : `${base}-${n}.png` }
      })
      .filter((x): x is { node: HTMLDivElement; name: string } => Boolean(x))

    if (entries.length === 0) {
      onToast('没有可导出的卡片', 'error')
      return
    }

    setExporting(true)
    setProgress('')
    try {
      await exportCardsAsZip(
        entries,
        `${safeFileName(doc.meta.title)}-配图.zip`,
        { backgroundColor: theme.bg },
        (done, total) => setProgress(`${done}/${total}`),
      )
      onToast(`已导出 ${entries.length} 张图`, 'success')
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
            width: CARD_WIDTH * PREVIEW_SCALE,
            height: CARD_HEIGHT * PREVIEW_SCALE,
            overflow: 'hidden',
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
            {selected ? <CardRenderer spec={selected} theme={theme} /> : null}
          </div>
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-muted)', textAlign: 'center' }}>
          1080 × 1440 · 小红书 3:4
        </div>
      </div>

      {/* ---------- 控制面板 ---------- */}
      <div className="studio-panel">
        <div className="side-title">
          <span>卡片</span>
          <span className="count">{cards.length} 张</span>
        </div>

        <div className="card-list">
          {cards.map((c) => {
            const t = getCardTheme(c.themeId)
            return (
              <button
                key={c.id}
                className={`card-item ${c.id === selectedId ? 'active' : ''}`}
                onClick={() => setSelectedId(c.id)}
              >
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
            {progress ? `导出中 ${progress}` : `导出全部（${cards.length} 张 zip）`}
          </button>
        </div>

        <div className="notice notice-info" style={{ marginTop: 14 }}>
          <span className="notice-mark">i</span>
          <span>
            卡片是纯 CSS 渲染，不引用文章配图 —— 这样导出不会因为外链图跨域而失败。
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
        {cards.map((c) => (
          <div
            key={c.id}
            ref={(el) => {
              nodeRefs.current[c.id] = el
            }}
          >
            <CardRenderer spec={c} theme={getCardTheme(c.themeId)} />
          </div>
        ))}
      </div>
    </div>
  )
}
