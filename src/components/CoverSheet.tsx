/**
 * 封面图面板
 *
 * 一次只给 3 张，是这个面板的核心决定：Unsplash 一个关键词能搜出几万张，
 * 给 20 张等于把「挑图」变成「刷图」，比写正文还费时间。3 张 + 「换一批」
 * 让选择有边界。
 *
 * 三件事必须做对，否则用起来会很难受：
 * 1. 额度要可见。demo Key 一小时 50 次，连点「换一批」很快就到顶。
 * 2. 署名要可点。摄影师名字链到他的 Unsplash 主页，这是 API 条款，
 *    不是装饰 —— 少了这个，Key 会被撤销。
 * 3. 中文词要提醒。Unsplash 图库是英文索引的，用中文 tag 直接搜
 *    命中率极低，界面上得说清楚，不然用户会以为功能坏了。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Doc } from '../core/ir'
import {
  UnsplashError,
  creditOf,
  downloadCoverPhoto,
  hasUnsplashKey,
  searchCoverPhotos,
  type CoverPhoto,
} from '../core/unsplash'
import {
  cleanCoverQuery,
  emptyHint,
  guessCoverQuery,
  localQueryCandidates,
  looksChinese,
  suggestCoverQueries,
} from '../core/cover-query'
import { resolveProvider } from '../ai/provider'
import { safeFileName } from '../cards/export'
import { copyPlain } from '../core/copy'

interface Props {
  open: boolean
  onClose: () => void
  doc: Doc | null
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void
  onOpenSettings: () => void
}

type Status = 'idle' | 'loading' | 'done' | 'error'

export function CoverSheet({ open, onClose, doc, onToast, onOpenSettings }: Props) {
  const [query, setQuery] = useState('')
  const [photos, setPhotos] = useState<CoverPhoto[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<{ kind: string; message: string } | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])
  const [downloadingId, setDownloadingId] = useState('')

  /** 本次会话是否已经自动搜过：额度金贵，每次打开都自动搜一次会很快烧光 */
  const autoSearched = useRef(false)
  /** 上一次渲染时的文章：换了文章，搜索词和候选图都得清掉重来 */
  const lastDoc = useRef<Doc | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const provider = useMemo(() => resolveProvider().provider, [open])

  const selected = photos.find((p) => p.id === selectedId) ?? null
  const keyReady = hasUnsplashKey()

  /* ---------------- 搜索 ---------------- */

  const runSearch = async (rawQuery: string, nextPage = 1) => {
    const q = cleanCoverQuery(rawQuery)
    if (!q) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('loading')
    setError(null)
    setPage(nextPage)
    setSelectedId('')

    try {
      const result = await searchCoverPhotos(q, { page: nextPage, perPage: 3, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setPhotos(result.photos)
      setRemaining(result.remaining)
      setHasMore(result.hasMore)
      setStatus('done')
      if (result.photos.length === 0) {
        setError({ kind: 'empty', message: emptyHint(q) })
      }
    } catch (e) {
      if (ctrl.signal.aborted) return
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (e instanceof UnsplashError) {
        setError({ kind: e.kind, message: e.message })
      } else {
        setError({ kind: 'network', message: e instanceof Error ? e.message : String(e) })
      }
      setStatus('error')
      setPhotos([])
      setHasMore(false)
    }
  }

  /* ---------------- 打开时预填 / 首次自动搜 ---------------- */

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort()
      return
    }
    if (!doc) return

    // 换了文章就得清干净：搜索词、候选图、选中态全是上一篇的，
    // 留着的话用户会拿着新文章搜上一篇的关键词，还以为是搜索坏了
    if (lastDoc.current !== doc) {
      lastDoc.current = doc
      autoSearched.current = false
      setQuery(guessCoverQuery(doc))
      setPhotos([])
      setSelectedId('')
      setError(null)
      setStatus('idle')
      setSuggested([])
    }

    // 只在第一次打开、且配了 Key 时自动搜一次 —— 用户点开就是想看图
    if (!autoSearched.current && hasUnsplashKey()) {
      const initial = guessCoverQuery(doc)
      if (initial) {
        autoSearched.current = true
        void runSearch(initial, 1)
      }
    }
    // runSearch 依赖的都是 ref/state，故意不列进依赖，避免每次输入都触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc])

  if (!open || !doc) return null

  /* ---------------- 动作 ---------------- */

  const nextBatch = () => {
    if (!query.trim()) return
    void runSearch(query, page + 1)
  }

  const runSuggest = async () => {
    if (!provider) {
      onToast('用 AI 想词要先配大模型，点「设置」填一个 Key', 'info')
      return
    }
    setSuggesting(true)
    try {
      const list = await suggestCoverQueries(doc, provider)
      if (list.length === 0) {
        onToast('AI 没给出可用的英文关键词，手动填一个吧', 'info')
        return
      }
      setSuggested(list)
      setQuery(list[0])
      await runSearch(list[0], 1)
    } finally {
      setSuggesting(false)
    }
  }

  const download = async (photo: CoverPhoto) => {
    setDownloadingId(photo.id)
    try {
      const name = `${safeFileName(doc.meta.title)}-封面-${photo.id.slice(0, 6)}.jpg`
      await downloadCoverPhoto(photo, name)
      // Unsplash 的 API 条款要求署名，图片本身是免费可商用的 —— 两件事别混
      onToast(`已下载。发布时标一下摄影师「${photo.author}」`, 'success')
    } catch (e) {
      onToast(e instanceof Error ? e.message : '下载失败', 'error')
    } finally {
      setDownloadingId('')
    }
  }

  const copyUrl = async (photo: CoverPhoto) => {
    try {
      await copyPlain(photo.regular)
      onToast('图片地址已复制（1080 宽，粘进编辑器刚好）', 'success')
    } catch {
      onToast('复制失败：浏览器拒绝了剪贴板访问', 'error')
    }
  }

  /* ---------------- 渲染 ---------------- */

  const locals = localQueryCandidates(doc, 3)
  const chips = [...new Set([...suggested, ...locals])].slice(0, 4)

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-cover" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">封面图 · Unsplash</span>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {!keyReady ? (
            <div className="notice notice-warn">
              <span className="notice-mark">!</span>
              <span>
                还没填 Unsplash Access Key。去{' '}
                <button className="link-btn" onClick={onOpenSettings}>
                  设置 → Unsplash 封面图
                </button>{' '}
                填一个（免费，注册后 1 分钟就能拿到）。Key 只存在这台浏览器里。
              </span>
            </div>
          ) : null}

          {/* ---------- 搜索行 ---------- */}
          <div className="cover-search">
            <input
              className="field-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch(query, 1)
              }}
              placeholder="英文关键词更容易命中，比如 laptop desk"
              spellCheck={false}
              disabled={!keyReady}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void runSearch(query, 1)}
              disabled={!keyReady || status === 'loading' || !query.trim()}
            >
              {status === 'loading' ? <span className="spinner" /> : null}
              {status === 'loading' ? '搜索中' : '找 3 张'}
            </button>
          </div>

          {/* ---------- 候选词 ---------- */}
          <div className="cover-suggest">
            <button
              className="link-btn"
              onClick={() => void runSuggest()}
              disabled={suggesting || !provider}
              title={provider ? '让模型把文章压成 3 组英文视觉关键词' : '先配一个大模型 Key'}
            >
              {suggesting ? 'AI 正在想词…' : '用 AI 想英文关键词'}
            </button>
            {chips.length > 0 ? (
              <div className="cover-chips">
                {chips.map((c) => (
                  <button
                    key={c}
                    className={`cover-chip ${c === query ? 'active' : ''}`}
                    onClick={() => {
                      setQuery(c)
                      void runSearch(c, 1)
                    }}
                    disabled={!keyReady}
                  >
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {looksChinese(query) ? (
            <div className="field-hint" style={{ marginTop: 6 }}>
              中文词在 Unsplash 上命中率很低 —— 图库是英文索引的。点上面的「用 AI 想英文关键词」，或者手动换成英文。
            </div>
          ) : null}

          {/* ---------- 错误 ---------- */}
          {error ? (
            <div className={`notice ${error.kind === 'rate' ? 'notice-warn' : 'notice-error'}`}>
              <span className="notice-mark">{error.kind === 'rate' ? '!' : '×'}</span>
              <span>{error.message}</span>
            </div>
          ) : null}

          {/* ---------- 3 张候选 ---------- */}
          {photos.length > 0 ? (
            <div className="cover-grid">
              {photos.map((p) => (
                <figure
                  key={p.id}
                  className={`cover-card ${p.id === selectedId ? 'active' : ''}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  {/* 底色放在 img 上：图没加载出来时先铺 Unsplash 给的主色，避免白闪 */}
                  <img
                    src={p.thumb}
                    alt={p.alt}
                    loading="lazy"
                    decoding="async"
                    style={{ background: p.color }}
                  />
                  <figcaption>
                    <a
                      className="cover-credit"
                      href={p.authorUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.author}
                    </a>
                    <a
                      className="cover-src"
                      href={p.pageUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Unsplash
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}

          {/* ---------- 选中后的大图与操作 ---------- */}
          {selected ? (
            <div className="cover-preview">
              <img src={selected.regular} alt={selected.alt} />
              <div className="cover-actions">
                <button
                  className="btn btn-sm btn-accent"
                  onClick={() => void download(selected)}
                  disabled={downloadingId === selected.id}
                >
                  {downloadingId === selected.id ? <span className="spinner" /> : null}
                  {downloadingId === selected.id ? '下载中…' : '下载这张'}
                </button>
                <button className="btn btn-sm" onClick={() => void copyUrl(selected)}>
                  复制图片地址
                </button>
                <a className="btn btn-sm" href={selected.pageUrl} target="_blank" rel="noreferrer">
                  打开图片页
                </a>
                <span className="cover-dim">
                  {selected.width}×{selected.height}
                </span>
              </div>
              <div className="cover-note">{creditOf(selected)}</div>
            </div>
          ) : null}

          {status === 'idle' && keyReady ? (
            <div className="stage-empty">填个词，或者直接用文章标签搜一下。</div>
          ) : null}
        </div>

        <div className="modal-foot">
          <span className="cover-quota">
            {remaining === null
              ? keyReady
                ? '额度：未知'
                : ''
              : `本小时还剩 ${remaining} 次（demo Key 上限 50）`}
          </span>
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          {hasMore ? (
            <button className="btn" onClick={nextBatch} disabled={status === 'loading'}>
              换一批
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
