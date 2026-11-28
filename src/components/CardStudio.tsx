import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { useMediaQuery } from '../hooks/useMediaQuery'

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

/** 宽屏下预览框的最大占位；实际缩放取它与容器可用宽度的较小值。
    宽屏保持这个比例（不放大），320px 窄屏则按可用宽度等比缩小，不会横向溢出。 */
const PREVIEW_BOX = { w: 440, h: 520 }

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

/** 离屏层只在导出时存在；单张导出只挂一张卡，全部导出才挂整套。 */
const ExportCardRenderer = memo(CardRenderer)

interface ExportRequest {
  formats: CardFormatId[]
  /** null = 整套卡片；数组 = 只挂这几张 */
  cardIds: string[] | null
}

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
  /** 卡片只保留 3:4（小红书竖图）；其它比例不常用，不再提供切换 */
  const format: CardFormatId = '3:4'
  /** 排版设置是否同步到全部卡片（文字内容不受影响） */
  const [applyAll, setApplyAll] = useState(false)

  // 破坏性操作：先变文案，再点一次才执行；失焦或 3 秒后恢复
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [confirmRebuild, setConfirmRebuild] = useState(false)

  // 离屏层默认不存在。单张/复制只挂当前卡 + 当前比例，全部导出才挂整套；
  // 导出结束立刻卸载。退出卡片页时如果导出还没开始，等 promise 也要解开，
  // 避免 async 永远悬着。
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null)
  const exportRequestRef = useRef<ExportRequest | null>(null)
  const exportReadyRef = useRef(false)
  const exportWaiters = useRef<Array<() => void>>([])

  /* 预览按容器宽度等比缩放：宽屏保持 PREVIEW_BOX 的原比例，窄到放不下时
     跟着可用宽度缩，避免 320px 下卡片预览把预览区撑出横向滚动。
     只影响显示，导出层按 fmt.w/fmt.h 原尺寸渲染，和这里无关。

     舞台宽度 = 图片显示宽度：翻页、加卡、导出都跟着图片走，不再拉满整列。
     宽屏可用宽度要扣掉右侧检查器和列间距；窄屏（单列）直接用 studio 宽度。 */
  const studioRef = useRef<HTMLDivElement>(null)
  const [studioWidth, setStudioWidth] = useState(0)
  const stacked = useMediaQuery('(max-width: 760px)')

  const measure = (el: HTMLElement | null, set: (n: number) => void) => {
    if (!el) return () => {}
    const apply = (width: number) => {
      const next = Math.round(width)
      set(next)
    }
    apply(el.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) apply(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }

  useLayoutEffect(() => {
    return measure(studioRef.current, (w) => setStudioWidth((prev) => (prev === w ? prev : w)))
  }, [])

  // 用户改过任何一张卡之后，就不再用新摘要覆盖他的编辑。
  // 这个标记跟着快照一起存：过几天回来，改过的卡仍然不许被覆盖。
  const dirty = useRef(restored?.dirty ?? false)

  // 导出的节点引用：离屏渲染完整尺寸，避免被预览缩放影响
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const addWrapRef = useRef<HTMLDivElement | null>(null)

  /** 等离屏层提交并完成一帧布局后，再让 html-to-image 读取节点。
      两个 rAF：第一个等 React commit，第二个等样式/布局稳定。 */
  useLayoutEffect(() => {
    if (!exportRequest) return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        exportReadyRef.current = true
        const waiters = exportWaiters.current.splice(0)
        for (const resolve of waiters) resolve()
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [exportRequest])

  useEffect(
    () => () => {
      // 真卸载时没有下一帧了，把等待者解开，让导出流程走到报错/收尾
      const waiters = exportWaiters.current.splice(0)
      for (const resolve of waiters) resolve()
    },
    [],
  )

  const ensureExportLayer = (formats: CardFormatId[], cardIds: string[] | null) => {
    const current = exportRequestRef.current
    const coversFormats = Boolean(current && formats.every((f) => current.formats.includes(f)))
    const coversCards = Boolean(
      current &&
        (current.cardIds === null ||
          (cardIds !== null && cardIds.every((id) => current.cardIds?.includes(id)))),
    )
    if (coversFormats && coversCards) {
      if (exportReadyRef.current) return Promise.resolve()
      return new Promise<void>((resolve) => exportWaiters.current.push(resolve))
    }
    const request = { formats, cardIds }
    exportRequestRef.current = request
    exportReadyRef.current = false
    setExportRequest(request)
    return new Promise<void>((resolve) => exportWaiters.current.push(resolve))
  }

  const clearExportLayer = () => {
    exportRequestRef.current = null
    exportReadyRef.current = false
    setExportRequest(null)
  }

  // 切卡时把右栏滚到「本张卡片」，否则会停在上一个版式的表单中部，
  // 看到的字段和刚点的卡对不上。用「上一次选中的 id」判断，避免 StrictMode
  // 下 effect 跑两遍时在首屏就滚走整套设置。
  const inspectorRef = useRef<HTMLElement | null>(null)
  const editorHeadRef = useRef<HTMLDivElement | null>(null)
  const lastSelected = useRef(selectedId)
  useEffect(() => {
    if (lastSelected.current === selectedId) return
    lastSelected.current = selectedId
    const box = inspectorRef.current
    const head = editorHeadRef.current
    if (!box || !head) return
    if (box.scrollHeight <= box.clientHeight + 4) return
    box.scrollTo({ top: Math.max(0, head.offsetTop - 4), behavior: 'smooth' })
  }, [selectedId])

  // 换选卡片或 3 秒后，把「确定删除」收回普通删除
  useEffect(() => {
    setConfirmRemoveId(null)
  }, [selectedId])
  useEffect(() => {
    if (!confirmRemoveId) return
    const t = setTimeout(() => setConfirmRemoveId(null), 3000)
    return () => clearTimeout(t)
  }, [confirmRemoveId])

  // 加卡菜单：Esc 关闭，点外面也关闭（不再只靠 mouseleave）
  useEffect(() => {
    if (!addOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddOpen(false)
        addWrapRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    const onDown = (e: MouseEvent) => {
      if (!addWrapRef.current?.contains(e.target as Node)) setAddOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [addOpen])

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
  // 宽屏最多缩到 PREVIEW_BOX 的比例（不放大）；容器比它还窄时按可用宽度再缩。
  // studioWidth 是 0（首帧还没量）时先用原比例，useLayoutEffect 会在绘制前补上。
  const baseScale = Math.min(PREVIEW_BOX.w / fmt.w, PREVIEW_BOX.h / fmt.h)
  const INSPECTOR_W = 320
  const STUDIO_GAP = 24
  const availableStage = stacked
    ? studioWidth
    : Math.max(0, studioWidth - INSPECTOR_W - STUDIO_GAP)
  const previewScale =
    availableStage > 0 ? Math.min(baseScale, availableStage / fmt.w) : baseScale
  const previewW = fmt.w * previewScale
  const previewH = fmt.h * previewScale

  const patch = (id: string, changes: Partial<CardSpec>) => {
    dirty.current = true
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...changes } : c)))
  }

  /**
   * 排版类改动（字号 / 密度 / 对齐 / 显示项）。
   * 勾了「同步到全部卡片」就落到所有卡片；文字、指标、条目仍走 patch()，只改当前这张。
   */
  const patchStyle = (changes: Partial<CardSpec>) => {
    dirty.current = true
    setCards((prev) =>
      prev.map((c) => (applyAll || c.id === selectedId ? { ...c, ...changes } : c)),
    )
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
    setConfirmRemoveId(null)
    setCards((prev) => {
      const index = prev.findIndex((c) => c.id === id)
      const next = renumber(prev.filter((c) => c.id !== id))
      if (selectedId === id) setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? '')
      return next
    })
  }

  /** 重新生成会覆盖所有手工修改；改过才需要第二次确认 */
  const requestRebuild = () => {
    if (!dirty.current) {
      rebuild()
      return
    }
    if (confirmRebuild) {
      setConfirmRebuild(false)
      rebuild()
      return
    }
    setConfirmRebuild(true)
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
    setExporting(true)
    try {
      await ensureExportLayer([format], [selected.id])
      const node = nodeRefs.current[`${selected.id}@${format}`]
      if (!node) {
        onToast('渲染节点还没准备好，请稍后重试', 'error')
        return
      }
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
      clearExportLayer()
    }
  }

  /** 复制图片：公众号后台、飞书、微信都可以直接粘贴，比先下载再上传省一步 */
  const copyImage = async () => {
    if (!selected) return
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      onToast('这个浏览器不支持复制图片，请用「导出这张」', 'info')
      return
    }
    setCopying(true)
    try {
      await ensureExportLayer([format], [selected.id])
      const node = nodeRefs.current[`${selected.id}@${format}`]
      if (!node) {
        onToast('渲染节点还没准备好，请稍后重试', 'error')
        return
      }
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
      clearExportLayer()
    }
  }

  const exportAll = async () => {
    if (cards.length === 0) {
      onToast('没有可导出的卡片', 'error')
      return
    }
    const formats = [fmt]

    setExporting(true)
    setProgress('')
    try {
      await ensureExportLayer(
        formats.map((f) => f.id),
        null,
      )

      // 编号本身就是唯一键（01..NN），不会重名，不需要再按出现次数加后缀 ——
      // 那个 `-2` 后缀反而会把 10 排到 2 后面去
      const entries: ZipEntry[] = []
      cards.forEach((c, i) => {
        const name = `${fileNameOf(c, i)}.png`
        for (const f of formats) {
          const node = nodeRefs.current[`${c.id}@${f.id}`]
          if (node) entries.push({ node, name, format: f.id })
        }
      })

      if (entries.length === 0) {
        onToast('没有可导出的卡片', 'error')
        return
      }

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
      clearExportLayer()
    }
  }

  const showKicker = selected?.showKicker !== false
  const showMark = selected?.showMark !== false
  const showFooter = selected?.showFooter !== false

  return (
    <div
      className="studio"
      ref={studioRef}
      style={{ '--studio-preview-w': `${previewW}px` } as React.CSSProperties}
    >
      {/* ---------- 中栏：预览 + 导出 ---------- */}
      <div className="studio-stage">
        <div
          className="studio-preview"
          style={{ width: previewW, height: previewH }}
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

          {/* 顶部卡片条去掉后，加卡与重新生成跟翻页放在同一行：
              这两个是整套卡片的操作，不占一整条横向空间。 */}
          <div className="studio-pager-actions">
            {selected?.id.startsWith('custom') ? (
              <button
                className={`btn btn-sm btn-quiet ${confirmRemoveId === selected.id ? 'btn-danger' : ''}`}
                onClick={() => {
                  if (confirmRemoveId === selected.id) removeCard(selected.id)
                  else setConfirmRemoveId(selected.id)
                }}
                onBlur={() => setConfirmRemoveId(null)}
                title={confirmRemoveId === selected.id ? '再点一次删除这张卡' : '删除这张自定义卡'}
              >
                {confirmRemoveId === selected.id ? '确定删除' : '删除这张'}
              </button>
            ) : null}
            <div className="add-wrap" ref={addWrapRef}>
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
            <button
              className={`btn btn-sm ${confirmRebuild ? 'btn-danger' : ''}`}
              onClick={requestRebuild}
              onBlur={() => setConfirmRebuild(false)}
              title={
                confirmRebuild
                  ? '再点一次会覆盖当前所有卡片'
                  : '按文章小节重新生成整套图；改过卡片时会先请你确认'
              }
            >
              {confirmRebuild ? '确定覆盖' : '重新生成'}
            </button>
          </div>
        </div>

        {/* 导出控制：跟着预览走，不用滚到右栏最底下才找得到 */}
        <div className="studio-export">
          <div className="studio-export-actions">
            <button className="btn btn-accent" onClick={exportOne} disabled={exporting || copying || !selected}>
              {exporting ? <span className="spinner" /> : null}
              导出这张
            </button>
            <button className="btn" onClick={exportAll} disabled={exporting || copying}>
              {progress ? `导出中 ${progress}` : `全部 ${cards.length} 张`}
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
        </div>
      </div>

      {/* ---------- 右栏：整套设置 + 当前卡内容 ---------- */}
      <section className="studio-inspector" aria-label="卡片设置" ref={inspectorRef}>
        {/* 配色 */}
        <div className="field">
          <span className="field-label">配色</span>
          <div className="studio-theme-row">
            {cardThemes.map((t) => (
              <button
                key={t.id}
                className={`theme-dot ${cardThemeId === t.id ? 'active' : ''}`}
                onClick={() => onThemeChange(t.id)}
                title={`${t.name}（底色 ${t.bg}，强调色 ${t.accent}）`}
                aria-label={`配色：${t.name}`}
                aria-pressed={cardThemeId === t.id}
                style={{ background: t.bg, borderColor: t.line }}
              >
                <span style={{ background: t.accent }} />
              </button>
            ))}
          </div>
        </div>

        {/* 编辑当前卡 */}
        {selected ? (
          <>
            {/* 署名 / 小标签 / 日期 放一行：右栏变宽后没必要各占一行 */}
            <div className="field-row field-row-3">
              <div className="field">
                <label className="field-label" htmlFor={`${fid}-site`}>
                  署名
                </label>
                <input
                  id={`${fid}-site`}
                  className="field-input"
                  value={siteName}
                  onChange={(e) => onSiteNameChange(e.target.value)}
                  placeholder={DEFAULT_SITE_NAME}
                />
              </div>
              {selected.layout !== 'end' ? (
                <div className="field">
                  <label className="field-label" htmlFor={`${fid}-kicker`}>
                    小标签
                  </label>
                  <input
                    id={`${fid}-kicker`}
                    className="field-input"
                    value={selected.kicker ?? ''}
                    onChange={(e) => patch(selected.id, { kicker: e.target.value })}
                    placeholder="留空则不显示"
                  />
                </div>
              ) : null}
              <div className="field">
                <label className="field-label" htmlFor={`${fid}-date`}>
                  日期
                </label>
                <input
                  id={`${fid}-date`}
                  className="field-input"
                  value={selected.date ?? ''}
                  onChange={(e) => patch(selected.id, { date: e.target.value })}
                  placeholder="2026.11.03"
                />
              </div>
            </div>

            {/* 排版：标题 + 同步开关同一行；切卡时右栏滚到这里 */}
            <div className="studio-group" ref={editorHeadRef}>
              <div className="studio-group-head">
                <div className="studio-group-title">排版</div>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={applyAll}
                    onChange={(e) => setApplyAll(e.target.checked)}
                  />
                  <span>同步到全部卡片</span>
                </label>
              </div>
              <div className="field-row">
                <div className="field">
                  <span className="field-label">字号</span>
                  <div className="segmented studio-seg">
                    {SIZE_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        className={(selected.size ?? 'md') === o.id ? 'active' : ''}
                        onClick={() => patchStyle({ size: o.id })}
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
                        onClick={() => patchStyle({ density: o.id })}
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
                        onClick={() => patchStyle({ align: o.id })}
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
                    onChange={(e) => patchStyle({ showKicker: e.target.checked })}
                  />
                  <span>小标签</span>
                </label>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={showMark}
                    onChange={(e) => patchStyle({ showMark: e.target.checked })}
                  />
                  <span>页码</span>
                </label>
                <label className="check-inline">
                  <input
                    type="checkbox"
                    checked={showFooter}
                    onChange={(e) => patchStyle({ showFooter: e.target.checked })}
                  />
                  <span>页脚</span>
                </label>
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor={`${fid}-title`}>
                主文字
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
                <span className="field-label">指标</span>
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
                    ? '要点（每行一条）'
                    : selected.layout === 'toc'
                      ? '目录（每行一节）'
                      : '对照（每行「左 | 右」）'}
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
                  {selected.layout === 'section' ? '摘要' : '副文字'}
                </label>
                <textarea
                  id={`${fid}-subtitle`}
                  className="field-textarea"
                  style={selected.layout === 'section' ? { minHeight: 96 } : undefined}
                  value={selected.subtitle ?? ''}
                  onChange={(e) => patch(selected.id, { subtitle: e.target.value })}
                />
                {selected.layout === 'section' && (selected.subtitle ?? '').length > 118 ? (
                  <div className="field-hint">超出 118 字，可能顶出画布</div>
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
                  按钮文字
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




          </>
        ) : null}
      </section>

      {/* ---------- 离屏渲染层：只在实际导出时挂载 ----------
          单张/复制只渲染当前卡 + 当前比例，全部导出才渲染整套；
          导出结束立即卸载。固定定位 + 1px 裁剪盒：预览区外层有入场动画
          （transform），fixed 会相对它定位；不裁掉时，几十张整尺寸卡片
          会把预览列的 scrollHeight 撑到近万像素 —— 滚动条很长，拉到底却是空的。
          节点本身仍有完整宽高，html-to-image 按节点尺寸导出，不受裁剪影响。 */}
      {exportRequest ? (
        <div
          className="studio-export-layer"
          aria-hidden
          style={{
            position: 'fixed',
            left: -20000,
            top: 0,
            width: 1,
            height: 1,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {CARD_FORMATS.filter((f) => exportRequest.formats.includes(f.id)).map((f) =>
            cards
              .filter((c) => !exportRequest.cardIds || exportRequest.cardIds.includes(c.id))
              .map((c) => (
                <div
                  key={`${c.id}@${f.id}`}
                  ref={(el) => {
                    nodeRefs.current[`${c.id}@${f.id}`] = el
                  }}
                  // 尺寸必须写死。这个容器是 shrink-to-fit 的，宽度由最宽的卡（16:9 的 960）
                  // 决定，不写 width 的话每张卡的父节点都是 960 宽，导出就按 960 算。
                  style={{ width: f.w, height: f.h }}
                >
                  <ExportCardRenderer spec={c} theme={getCardTheme(c.themeId)} format={f.id} />
                </div>
              )),
          )}
        </div>
      ) : null}
    </div>
  )
}
