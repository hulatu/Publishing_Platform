import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
  layoutHints,
  layoutNames,
  type CardAlign,
  type CardDensity,
  type CardFormatId,
  type CardLayout,
  type CardSize,
  type CardSpec,
} from '../cards/types'
import { hashDoc, readCardSnapshot, saveCardSnapshot } from '../cards/store'

interface Props {
  doc: Doc
  /** 与草稿箱、发布台账同源的 key：卡片快照按它落盘 */
  articleKey: string
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
const PREVIEW_BOX = { w: 400, h: 500 }

/** 加卡菜单的顺序：常用版式在前，首尾两张放最后 */
const ADDABLE: CardLayout[] = ['quote', 'points', 'section', 'stat', 'toc', 'compare', 'cta', 'cover', 'end']

/** 支持居中排版的版式：清单/目录/对照是表格性结构，居中会失去对齐 */
const CENTERABLE: CardLayout[] = ['cover', 'quote', 'section', 'stat', 'cta', 'end']

const SIZE_OPTIONS: { id: CardSize; label: string }[] = [
  { id: 'sm', label: '小' },
  { id: 'md', label: '标准' },
  { id: 'lg', label: '大' },
]

const DENSITY_OPTIONS: { id: CardDensity; label: string }[] = [
  { id: 'compact', label: '紧凑' },
  { id: 'normal', label: '标准' },
  { id: 'airy', label: '舒展' },
]

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
  articleKey,
  sections,
  summaries,
  cardThemeId,
  onThemeChange,
  siteName,
  onSiteNameChange,
  onToast,
}: Props) {
  /** 正文指纹：换文章 / 正文结构变了，本地快照就不能再用 */
  const hash = useMemo(() => hashDoc(doc.rawMd), [doc.rawMd])
  /** 首屏恢复一次：放进 useState 初始化，避免先闪一帧默认套图 */
  const [restored] = useState(() => readCardSnapshot(articleKey, hash))
  const [cards, setCards] = useState<CardSpec[]>(() =>
    restored?.cards ?? renumber(buildCards({ doc, themeId: cardThemeId, siteName, sections, summaries })),
  )
  /** 表单字段 id 前缀：读屏靠 htmlFor 找到输入框 */
  const fid = useId()
  const [selectedId, setSelectedId] = useState(restored?.selectedId ?? 'cover')
  const [exporting, setExporting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [progress, setProgress] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [format, setFormat] = useState<CardFormatId>('3:4')
  const [multiSize, setMultiSize] = useState(false)

  // 拖拽排序
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  // 用户改过任何一张卡之后，就不再用新摘要覆盖他的编辑。
  // 这个标记跟着快照一起存：过几天回来，改过的卡仍然不许被覆盖。
  const dirty = useRef(restored?.dirty ?? false)

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
  const contentKey = doc.rawMd
  /** 首次挂载已经由 useState 从快照恢复过，这里只处理「换了文章」 */
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const saved = readCardSnapshot(articleKey, hash)
    if (saved) {
      setCards(saved.cards)
      setSelectedId(saved.selectedId)
      dirty.current = saved.dirty
      return
    }
    dirty.current = false
    rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey, hash])

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

  /* ---------------- 快照落盘 ---------------- */

  /** 卸载时要补一次，所以身份和最新状态都得放在 ref 里 */
  const current = useRef({ articleKey, hash, cards, selectedId })
  current.current = { articleKey, hash, cards, selectedId }
  /** 存储写不进去只提醒一次，别每敲一个字就弹一条 */
  const warned = useRef(false)

  // 500ms 防抖：改一个字就落盘，但不必每个字符都 JSON.stringify 一遍
  useEffect(() => {
    if (!articleKey) return
    const t = setTimeout(() => {
      const ok = saveCardSnapshot(articleKey, { hash, dirty: dirty.current, selectedId, cards })
      if (!ok && !warned.current) {
        warned.current = true
        onToast('卡片没写进本地存储，切换平台后可能丢失', 'error')
      }
    }, 500)
    return () => clearTimeout(t)
  }, [cards, selectedId, articleKey, hash, onToast])

  // 改完立刻切平台时防抖还没到点，卸载时把最后一次状态补上
  useEffect(
    () => () => {
      const { articleKey: key, hash: h, cards: c, selectedId: sid } = current.current
      if (key) saveCardSnapshot(key, { hash: h, dirty: dirty.current, selectedId: sid, cards: c })
    },
    [],
  )

  const selectedIndex = Math.max(
    0,
    cards.findIndex((c) => c.id === selectedId),
  )
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
    const spec = { ...makeCard(doc, layout, cardThemeId, siteName, sections), id }
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

  /** 上/下一张：到头就绕回去，键盘 ← → 也走这里 */
  const go = (delta: number) => {
    if (cards.length < 2) return
    const next = cards[(selectedIndex + delta + cards.length) % cards.length]
    if (next) setSelectedId(next.id)
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
      const base = fileNameOf(selected, selectedIndex)
      downloadBlob(blob, `${base}-${format.replace(':', 'x')}.png`)
      onToast(`已导出 ${px ? `${px.w}×${px.h}` : `${fmt.w * 2}×${fmt.h * 2}`} PNG`, 'success')
    } catch (e) {
      onToast(`导出失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  /** 复制图片：公众号后台、飞书、微信都可以直接粘贴，比先下载再上传省一步 */
  const copyImage = async () => {
    if (!selected) return
    const node = nodeRefs.current[`${selected.id}@${format}`]
    if (!node) {
      onToast('渲染节点还没准备好，请稍后重试', 'error')
      return
    }
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      onToast('这个浏览器不支持复制图片，请用「导出这张」', 'info')
      return
    }
    setCopying(true)
    try {
      // 把 Blob 的 Promise 直接交给 ClipboardItem：渲染要一两秒，
      // 先 await 再 write 会把用户点击的临时授权耗掉，Safari 会直接拒绝写入。
      const blobPromise = renderCardToBlob(node, { backgroundColor: theme.bg, format })
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })])
      const px = await readPngSize(await blobPromise)
      onToast(`已复制 ${px ? `${px.w}×${px.h}` : 'PNG'} 到剪贴板`, 'success')
    } catch (e) {
      onToast(`复制失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setCopying(false)
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

  const showKicker = selected?.showKicker !== false
  const showMark = selected?.showMark !== false
  const showFooter = selected?.showFooter !== false

  return (
    <div className="studio">
      {/* ---------- 左栏：预览 + 导出 ---------- */}
      <div className="studio-stage">
        <div className="studio-stage-head">
          <span className="studio-stage-label">预览</span>
          <span className="studio-stage-meta">
            {selected ? `${layoutNames[selected.layout]} · ${cardNo(selectedIndex + 1)}/${cardNo(cards.length)}` : '—'}
          </span>
        </div>

        <div
          className="studio-preview"
          style={{ width: fmt.w * previewScale, height: fmt.h * previewScale }}
          tabIndex={0}
          role="img"
          aria-label={selected ? `第 ${selectedIndex + 1} 张卡片预览：${selected.title}` : '卡片预览'}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault()
              go(-1)
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              go(1)
            }
          }}
        >
          <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>
            {selected ? <CardRenderer spec={selected} theme={theme} format={format} /> : null}
          </div>
        </div>

        <div className="studio-pager">
          <button className="pager-btn" onClick={() => go(-1)} disabled={cards.length < 2} aria-label="上一张">
            ←
          </button>
          <span className="pager-count">
            {cardNo(selectedIndex + 1)} / {cardNo(cards.length)}
          </span>
          <button className="pager-btn" onClick={() => go(1)} disabled={cards.length < 2} aria-label="下一张">
            →
          </button>
          <span className="pager-hint">← → 切换</span>
        </div>

        {/* 导出控制：跟着预览走，不用滚到右栏最底下才找得到 */}
        <div className="studio-export">
          <div className="studio-export-head">
            <span className="studio-export-title">导出</span>
            <span className="studio-export-spec">成品 {fmt.w * 2} × {fmt.h * 2}</span>
          </div>

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

          <label className="check-row">
            <input type="checkbox" checked={multiSize} onChange={(e) => setMultiSize(e.target.checked)} />
            <span>导出全部时三种尺寸各出一套（zip 内分文件夹）</span>
          </label>

          <div className="studio-export-actions">
            <button className="btn btn-accent" onClick={exportOne} disabled={exporting || copying || !selected}>
              {exporting ? <span className="spinner" /> : null}
              导出这张
            </button>
            <button className="btn" onClick={exportAll} disabled={exporting || copying}>
              {progress
                ? `导出中 ${progress}`
                : multiSize
                  ? `全部 ${cards.length * CARD_FORMATS.length} 张`
                  : `全部 ${cards.length} 张`}
            </button>
            <button
              className="btn btn-quiet"
              onClick={copyImage}
              disabled={exporting || copying || !selected}
              title="把这张图复制到剪贴板，可直接粘进公众号后台"
            >
              {copying ? <span className="spinner" /> : null}
              复制图片
            </button>
          </div>

          <p className="studio-export-note">
            文件名带两位编号，按名称排序就是卡片顺序。纯 CSS 渲染、不引用文章配图，导出不会因外链跨域失败。
          </p>
        </div>
      </div>

      {/* ---------- 右栏：卡片列表 + 内容编辑 ---------- */}
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
                  <button key={l} onClick={() => addCard(l)} title={layoutHints[l]}>
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
          <span className="field-label">配色 · 一套图共用</span>
          <div className="theme-row">
            {cardThemes.map((t) => (
              <button
                key={t.id}
                className={`theme-chip ${cardThemeId === t.id ? 'active' : ''}`}
                onClick={() => onThemeChange(t.id)}
                title={`${t.name}（底色 ${t.bg}，强调色 ${t.accent}）`}
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
          <label className="field-label" htmlFor={`${fid}-site`}>
            署名（卡片底部）
          </label>
          <input
            id={`${fid}-site`}
            className="field-input"
            value={siteName}
            onChange={(e) => onSiteNameChange(e.target.value)}
            placeholder={DEFAULT_SITE_NAME}
          />
        </div>

        {/* 编辑当前卡 */}
        {selected ? (
          <>
            <div className="studio-editor-head">
              <span className="studio-editor-title">第 {selectedIndex + 1} 张 · {layoutNames[selected.layout]}</span>
              <span className="studio-editor-hint">{layoutHints[selected.layout]}</span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor={`${fid}-title`}>
                主文字
                {selected.layout === 'cover' || selected.layout === 'compare'
                  ? '（标题）'
                  : selected.layout === 'points'
                    ? '（小标题）'
                    : selected.layout === 'toc'
                      ? '（目录标题）'
                      : selected.layout === 'stat'
                        ? '（小标题）'
                        : selected.layout === 'section'
                          ? '（小节标题）'
                          : ''}
              </label>
              <textarea
                id={`${fid}-title`}
                className="field-textarea"
                value={selected.title}
                onChange={(e) => patch(selected.id, { title: e.target.value })}
              />
            </div>

            {/* 数据卡：指标是「大数字 + 一行说明」 */}
            {selected.layout === 'stat' ? (
              <div className="field">
                <span className="field-label">指标（最多 3 项，数字用你文章里的原话）</span>
                <div className="stat-rows">
                  {(selected.stats ?? []).map((s, i) => (
                    <div className="stat-row" key={i}>
                      <input
                        className="field-input stat-value"
                        value={s.value}
                        onChange={(e) =>
                          patch(selected.id, {
                            stats: (selected.stats ?? []).map((x, j) =>
                              j === i ? { ...x, value: e.target.value } : x,
                            ),
                          })
                        }
                        placeholder="98%"
                        aria-label={`第 ${i + 1} 项数字`}
                      />
                      <input
                        className="field-input"
                        value={s.label}
                        onChange={(e) =>
                          patch(selected.id, {
                            stats: (selected.stats ?? []).map((x, j) =>
                              j === i ? { ...x, label: e.target.value } : x,
                            ),
                          })
                        }
                        placeholder="一短句说明"
                        aria-label={`第 ${i + 1} 项说明`}
                      />
                      <button
                        className="icon-btn"
                        onClick={() =>
                          patch(selected.id, { stats: (selected.stats ?? []).filter((_, j) => j !== i) })
                        }
                        aria-label="删除这项指标"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn-sm"
                  disabled={(selected.stats ?? []).length >= 3}
                  onClick={() =>
                    patch(selected.id, { stats: [...(selected.stats ?? []), { value: '', label: '' }] })
                  }
                >
                  + 加一项
                </button>
              </div>
            ) : selected.layout === 'points' || selected.layout === 'toc' || selected.layout === 'compare' ? (
              <div className="field">
                <label className="field-label" htmlFor={`${fid}-points`}>
                  {selected.layout === 'points'
                    ? '要点（每行一条，最多 5 条生效）'
                    : selected.layout === 'toc'
                      ? '目录条目（每行一节，最多 6 条）'
                      : '对照条目（每行「左 | 右」，最多 4 行）'}
                </label>
                <textarea
                  id={`${fid}-points`}
                  className="field-textarea"
                  style={{ minHeight: 110 }}
                  value={(selected.points ?? []).join('\n')}
                  onChange={(e) =>
                    patch(selected.id, {
                      points: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  placeholder={selected.layout === 'compare' ? '先写结构 | 先写开头' : ''}
                />
              </div>
            ) : (
              <div className="field">
                <label className="field-label" htmlFor={`${fid}-subtitle`}>
                  {selected.layout === 'section' ? '本节内容（摘要）' : '副文字'}
                </label>
                <textarea
                  id={`${fid}-subtitle`}
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

            {/* 对照卡的两栏标题 + 引导卡的按钮文字 */}
            {selected.layout === 'compare' ? (
              <div className="field-row">
                <div className="field">
                  <label className="field-label" htmlFor={`${fid}-left`}>
                    左栏标题
                  </label>
                  <input
                    id={`${fid}-left`}
                    className="field-input"
                    value={selected.leftLabel ?? ''}
                    onChange={(e) => patch(selected.id, { leftLabel: e.target.value })}
                    placeholder="做法 A"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={`${fid}-right`}>
                    右栏标题
                  </label>
                  <input
                    id={`${fid}-right`}
                    className="field-input"
                    value={selected.rightLabel ?? ''}
                    onChange={(e) => patch(selected.id, { rightLabel: e.target.value })}
                    placeholder="做法 B"
                  />
                </div>
              </div>
            ) : null}

            {selected.layout === 'cta' ? (
              <div className="field">
                <label className="field-label" htmlFor={`${fid}-cta`}>
                  按钮文字（留空则不显示）
                </label>
                <input
                  id={`${fid}-cta`}
                  className="field-input"
                  value={(selected.points ?? [])[0] ?? ''}
                  onChange={(e) => patch(selected.id, { points: e.target.value ? [e.target.value] : [] })}
                  placeholder="长按识别 · 关注"
                />
              </div>
            ) : null}

            {/* 排版 */}
            <div className="studio-group">
              <div className="studio-group-title">排版</div>
              <div className="field-row">
                <div className="field">
                  <span className="field-label">字号</span>
                  <div className="segmented studio-seg">
                    {SIZE_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        className={(selected.size ?? 'md') === o.id ? 'active' : ''}
                        onClick={() => patch(selected.id, { size: o.id })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">密度</span>
                  <div className="segmented studio-seg">
                    {DENSITY_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        className={(selected.density ?? 'normal') === o.id ? 'active' : ''}
                        onClick={() => patch(selected.id, { density: o.id })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {CENTERABLE.includes(selected.layout) ? (
                <div className="field">
                  <span className="field-label">对齐</span>
                  <div className="segmented studio-seg">
                    {(
                      [
                        { id: 'left', label: '左对齐' },
                        { id: 'center', label: '居中' },
                      ] as { id: CardAlign; label: string }[]
                    ).map((o) => (
                      <button
                        key={o.id}
                        className={(selected.align ?? 'left') === o.id ? 'active' : ''}
                        onClick={() => patch(selected.id, { align: o.id })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flag-row">
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={showKicker}
                    onChange={(e) => patch(selected.id, { showKicker: e.target.checked })}
                  />
                  <span>小标签</span>
                </label>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={showMark}
                    onChange={(e) => patch(selected.id, { showMark: e.target.checked })}
                  />
                  <span>页码</span>
                </label>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={showFooter}
                    onChange={(e) => patch(selected.id, { showFooter: e.target.checked })}
                  />
                  <span>页脚</span>
                </label>
              </div>
            </div>

            {selected.layout !== 'end' ? (
              <div className="field">
                <label className="field-label" htmlFor={`${fid}-kicker`}>
                  左上角小标签
                </label>
                <input
                  id={`${fid}-kicker`}
                  className="field-input"
                  value={selected.kicker ?? ''}
                  onChange={(e) => patch(selected.id, { kicker: e.target.value })}
                  placeholder="分类，留空则不显示"
                />
              </div>
            ) : null}

            <div className="field">
              <label className="field-label" htmlFor={`${fid}-date`}>
                底部日期
              </label>
              <input
                id={`${fid}-date`}
                className="field-input"
                value={selected.date ?? ''}
                onChange={(e) => patch(selected.id, { date: e.target.value })}
                placeholder="2026.11.03"
              />
            </div>
          </>
        ) : null}
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
