/**
 * 正文图片清单
 *
 * 两个用途，都挂在同一个面板上：
 * 1. 体检 —— 发布前查一遍「能不能取到 / 别的站引用会不会被拒 / 多大 / 什么格式」；
 * 2. 导出 —— 按 01.jpg 这样的序号拿一份「这个平台能直接用」的图。
 *
 * 顺序就是使用顺序：先体检，再导出。
 *
 * 这里**不接管图床**：图片从哪来、存在哪，是作者自己的事（upic + R2 也好，
 * 别的图床也好）。工具只读 md 里的链接，不改写、不上传、不替你换地址。
 * 一个发布台如果连图床都要管，那就变成了另一个图床。
 *
 * 跨域是常态：图床没开 CORS 时 fetch 会失败。这时先退到同源代理
 * （functions/api/img.ts，Pages 部署后才有）再试一次，还不行才降级成
 * 「打开原图」逐张存。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImageRef } from '../core/ir'
import { mapLimit } from '../core/async'
import { downloadBlob } from '../cards/export'
import { safeFileName } from '../cards/export'
import {
  auditImage,
  fmtBytes,
  imageRule,
  mimeExt,
  summarize,
  type AuditRow,
  type ImageIssue,
} from '../core/image-audit'
import {
  IMAGE_CONCURRENCY,
  exportRule,
  fetchImage,
  fileNameFor,
  fmtSize,
  manifestText,
  planSummary,
  transcode,
  type ManifestRow,
} from '../core/image-export'

interface Props {
  open: boolean
  onClose: () => void
  images: ImageRef[]
  title: string
  /** 当前平台，决定体检阈值和导出规则（公众号禁 SVG、小红书要 3:4） */
  platform: string
  /** 平台显示名，只用在清单和提示里 */
  platformLabel: string
}

type Status = 'idle' | 'busy' | 'ok' | 'fail'
type Tab = 'audit' | 'export'

/** 最严重的那条结论，缩略图角标只显示它 —— 一张图挂三处，先说致命的那处 */
function worst(issues: ImageIssue[]): ImageIssue | null {
  return issues.find((i) => i.level === 'error') ?? issues[0] ?? null
}

/** 事实行：能确定的才写，缺的跳过，不留「undefined × undefined」 */
function factLine(row: AuditRow | undefined, hasLocal: boolean): string {
  if (!row) return ''
  const parts: string[] = []
  if (row.width && row.height) parts.push(`${row.width}×${row.height}`)
  if (typeof row.bytes === 'number') parts.push(fmtBytes(row.bytes))
  const ext = mimeExt(row.contentType)
  if (ext) parts.push(ext.toUpperCase())
  if (parts.length === 0 && hasLocal) return '本地图片，没有可探测的地址'
  if (parts.length === 0 && row.loaded === false) return '取不到'
  return parts.join(' · ')
}

export function ImageList({ open, onClose, images, title, platform, platformLabel }: Props) {
  /** 体检 / 导出 —— 同一批图片的两件事，放一个面板里省一个顶栏入口 */
  const [tab, setTab] = useState<Tab>('audit')
  const [status, setStatus] = useState<Record<string, Status>>({})
  /** <img> 自身加载失败（链接失效、防盗链），和「跨域打不进包」是两回事 */
  const [broken, setBroken] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState(false)
  /** 已处理完的张数，用于「3 / 20」进度 */
  const [done, setDone] = useState(0)
  /** 打包阶段（不是下载阶段）的失败原因 */
  const [error, setError] = useState('')
  /** 上一次导出留下的「没处理」说明，按编号对齐，导出完才显示 */
  const [notes, setNotes] = useState<{ name: string; text: string }[]>([])
  /** 导出后每张的结果：体积 + 处理说明。不解压也能看见发生了什么 */
  const [outRows, setOutRows] = useState<Record<string, { bytes: number; done: string; skipped: string }>>({})

  /** 导出规则：这个平台对图片有什么硬要求 */
  const outRule = useMemo(() => exportRule(platform), [platform])

  /* ---------- 体检 ---------- */

  const rule = useMemo(() => imageRule(platform), [platform])
  const [rows, setRows] = useState<Record<string, AuditRow>>({})
  const [auditing, setAuditing] = useState(false)
  const [auditDone, setAuditDone] = useState(0)
  /** 这一轮跑过没有。没跑过时不能声称「都没问题」 */
  const [audited, setAudited] = useState(false)
  /** 代理完全不可用（本地 dev）：那不是图的问题，是环境的问题 */
  const [noProxy, setNoProxy] = useState(false)
  const runId = useRef(0)

  const startAudit = () => {
    const id = ++runId.current
    setAuditing(true)
    setAuditDone(0)
    setNoProxy(false)
    setRows({})

    void (async () => {
      let proxyOk = 0
      const list = await mapLimit(images, IMAGE_CONCURRENCY, async (img) => {
        const row = await auditImage(img.src, rule)
        if (row.probed) proxyOk++
        if (runId.current === id) {
          setRows((prev) => ({ ...prev, [img.src]: row }))
          setAuditDone((n) => n + 1)
        }
        return row
      })
      if (runId.current !== id) return
      // 全部图片都探不到代理，说明是 Functions 没部署，不是图有问题
      setNoProxy(list.length > 0 && proxyOk === 0 && list.every((r) => !r.probed))
      setAudited(true)
      setAuditing(false)
    })()
  }

  // 打开面板就自动跑一遍。切走或关掉时作废这一轮 —— 否则回来会看到上一轮的半截结果。
  useEffect(() => {
    if (!open || images.length === 0) {
      setAudited(false)
      setRows({})
      return
    }
    startAudit()
    return () => {
      runId.current++
    }
    // images 是每次渲染新建的数组，按长度 + 首尾地址判断「换了一篇文章」
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, images.length, images[0]?.src, rule])

  const auditList = useMemo(() => images.map((img) => rows[img.src]).filter((r): r is AuditRow => Boolean(r)), [images, rows])
  const summary = useMemo(() => summarize(auditList, auditList.some((r) => r.probed)), [auditList])
  /** 去重后的问题清单：同一句「防盗链」说 20 遍没有意义 */
  const distinctIssues = useMemo(() => {
    const out: { issue: ImageIssue; count: number }[] = []
    for (const r of auditList) {
      for (const i of r.issues) {
        const hit = out.find((o) => o.issue.tag === i.tag)
        if (hit) hit.count++
        else out.push({ issue: i, count: 1 })
      }
    }
    // 致命问题排前面；同级别按影响面从大到小
    return out.sort((a, b) =>
      a.issue.level === b.issue.level ? b.count - a.count : a.issue.level === 'error' ? -1 : 1,
    )
  }, [auditList])

  const failed = useMemo(
    () => images.filter((img) => status[img.src] === 'fail').length,
    [images, status],
  )

  if (!open) return null

  const setOne = (src: string, s: Status) => setStatus((prev) => ({ ...prev, [src]: s }))

  const exportAll = async () => {
    if (images.length === 0 || busy) return
    setBusy(true)
    setStatus({})
    setDone(0)
    setError('')
    setNotes([])
    setOutRows({})

    let ok = 0

    try {
      // 并发取图 + 转码。编号放在最后按原顺序做 —— 并发是乱序完成的，
      // 边转边编号会把 03 号图存成 01。
      const results = await mapLimit(images, IMAGE_CONCURRENCY, async (img) => {
        setOne(img.src, 'busy')
        try {
          const blob = await fetchImage(img.src)
          // 体检那一轮已经量过尺寸和体积，这里直接复用，省一轮重复请求。
          // 没体检过也能跑：facts 全空时 planExport 会退化成「原样导出」。
          const row = rows[img.src]
          const out = await transcode(blob, outRule, {
            bytes: row?.bytes,
            contentType: row?.contentType ?? blob.type,
            width: row?.width,
            height: row?.height,
            urlExt: mimeExt(row?.contentType) || undefined,
          })
          setOne(img.src, 'ok')
          ok++
          return { blob: out.blob, ext: out.ext, done: out.done, skipped: out.skipped, src: img }
        } catch {
          setOne(img.src, 'fail')
          return null
        } finally {
          setDone((n) => n + 1)
        }
      })

      if (ok === 0) return

      // jszip 只在真的要打包时下载，不进首屏
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const folder = zip.folder('images') ?? zip
      const manifest: ManifestRow[] = []

      results.forEach((r, i) => {
        if (!r) return
        const name = fileNameFor(i, r.ext)
        folder.file(name, r.blob)
        manifest.push({
          name,
          src: r.src.src,
          alt: r.src.alt,
          bytes: r.blob.size,
          done: r.done,
          skipped: r.skipped,
        })
      })

      // 清单和图片放一起：解开 zip 只看文件名，对不上文中位置，会传错顺序
      const when = new Date().toLocaleString('zh-CN', { hour12: false })
      zip.file('图片清单.txt', manifestText(manifest, platformLabel, when))

      const out = await zip.generateAsync({ type: 'blob' })
      downloadBlob(out, `${safeFileName(title)}-${platformLabel}图片.zip`)

      // 卡片上就地显示结果：不用解压就能确认「哪张被压了、哪张没动」
      const shown: Record<string, { bytes: number; done: string; skipped: string }> = {}
      results.forEach((r) => {
        if (!r) return
        shown[r.src.src] = {
          bytes: r.blob.size,
          done: r.done.join('；'),
          skipped: r.skipped.join('；'),
        }
      })
      setOutRows(shown)
      setNotes(manifest.filter((m) => m.skipped.length > 0).map((m) => ({ name: m.name, text: m.skipped.join('；') })))
    } catch (e) {
      // 图下好了却打包失败（图太大、内存不够）以前是静默什么都不发生，
      // 用户会以为是没点到按钮
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** 缩略图 + 元信息。体检和导出共用，区别只在右上角那个角标。 */
  const grid = (mode: 'audit' | 'export') => (
    <div className="img-grid">
      {images.map((img, i) => {
        const row = rows[img.src]
        const issue = row ? worst(row.issues) : null
        const s = status[img.src] ?? 'idle'
        const isLocal = !/^https?:\/\//i.test(img.src) && !img.src.startsWith('//')
        const facts = factLine(row, isLocal)
        return (
          <div className="img-item" key={img.src}>
            <div className="img-thumb">
              <img
                src={img.src}
                alt={img.alt}
                referrerPolicy="no-referrer"
                loading="lazy"
                className={broken[img.src] ? 'is-broken' : undefined}
                onError={() => setBroken((p) => ({ ...p, [img.src]: true }))}
              />
              {broken[img.src] ? <span className="img-broken">图片加载失败</span> : null}
              <span className="img-index">{String(i + 1).padStart(2, '0')}</span>
              {mode === 'audit'
                ? issue && <span className={`img-badge ${issue.level}`} title={issue.detail}>{issue.tag}</span>
                : null}
              {mode === 'export' && s === 'ok' ? <span className="img-badge ok">✓</span> : null}
              {mode === 'export' && s === 'fail' ? <span className="img-badge fail">失败</span> : null}
              {mode === 'export' && s === 'busy' ? <span className="img-badge busy">…</span> : null}
            </div>
            <div className="img-meta">
              <span className="img-alt" title={img.alt || img.src}>
                {img.alt || '（无说明文字）'}
              </span>
              {mode === 'audit' && facts ? <span className="img-facts">{facts}</span> : null}
              {mode === 'export' && outRows[img.src] ? (
                <span
                  className="img-facts"
                  title={
                    [outRows[img.src].done, outRows[img.src].skipped].filter(Boolean).join('；') ||
                    '原样导出，没有重新编码'
                  }
                >
                  {fmtSize(outRows[img.src].bytes)}
                  {/* 「已处理」和「未处理」必须分开：动图是没处理，不是处理过 */}
                  {outRows[img.src].done
                    ? ' · 已处理'
                    : outRows[img.src].skipped
                      ? ' · 未处理'
                      : ' · 原样'}
                </span>
              ) : null}
              <a className="img-open" href={img.src} target="_blank" rel="noreferrer">
                打开原图
              </a>
            </div>
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal img-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">正文图片</div>
            <div className="ledger-sub">
              共 {images.length} 张 · 按文中出现顺序编号
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="segmented img-tabs">
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
              体检
            </button>
            <button className={tab === 'export' ? 'active' : ''} onClick={() => setTab('export')}>
              导出
            </button>
          </div>

          {tab === 'export' ? (
            <>
              <div className="notice notice-info" style={{ marginBottom: 14 }}>
                <span className="notice-mark">i</span>
                <span>
                  按正文出现顺序编号，打包成 zip，里面附一份「图片清单.txt」对上位置。
                  {planSummary(outRule)}
                  <span className="audit-why">{outRule.note}</span>
                </span>
              </div>

              {images.length === 0 ? (
                <div className="check-empty" style={{ padding: '30px 0' }}>
                  这篇文章里没有图片。
                </div>
              ) : (
                grid('export')
              )}

              {error ? (
                <div className="notice notice-warn" style={{ marginTop: 12 }}>
                  <span className="notice-mark">!</span>
                  <span>打包失败：{error}。图片已下载完成但压缩出错，可以逐张「打开原图」另存。</span>
                </div>
              ) : null}

              {failed > 0 ? (
                <div className="notice notice-warn" style={{ marginTop: 12 }}>
                  <span className="notice-mark">!</span>
                  <span>
                    {failed} 张没导出来：站点没开跨域、代理也没放行（域名不在{' '}
                    <code>functions/api/img.ts</code> 的白名单里），或者这张图本身就取不到。
                    点每张下面的「打开原图」另存即可。
                  </span>
                </div>
              ) : null}

              {notes.length > 0 ? (
                <div className="notice notice-warn" style={{ marginTop: 12 }}>
                  <span className="notice-mark">!</span>
                  <span>
                    {notes.length} 张按原样导出，没有处理：
                    <span className="audit-why">
                      {notes.map((n) => `${n.name} — ${n.text}`).join('；')}
                    </span>
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {/* 体检结论。有错就红、只有提醒就黄、干净才绿 —— 别一律用同一种颜色 */}
              <div
                className={`notice ${summary.errors > 0 ? 'notice-error' : summary.warns > 0 ? 'notice-warn' : 'notice-ok'}`}
                style={{ marginBottom: 12 }}
              >
                <span className="notice-mark">{summary.errors > 0 ? '!' : summary.warns > 0 ? '!' : '✓'}</span>
                <span>
                  {auditing ? `正在体检 ${auditDone}/${images.length}…` : summary.line}
                  {!auditing && !summary.clean && distinctIssues.length > 0 ? (
                    <span className="audit-why">「{distinctIssues[0].issue.tag}」{distinctIssues[0].issue.detail}</span>
                  ) : null}
                </span>
              </div>

              {noProxy ? (
                <div className="notice notice-info" style={{ marginBottom: 12 }}>
                  <span className="notice-mark">i</span>
                  <span>
                    图片代理不可用，只查了「能不能取到」。体积和格式要部署到 Cloudflare Pages
                    才有（本地 <code>npm run dev</code> 没有 <code>/api/img</code>）。
                  </span>
                </div>
              ) : null}

              {images.length === 0 ? (
                <div className="check-empty" style={{ padding: '30px 0' }}>
                  这篇文章里没有图片。
                </div>
              ) : (
                grid('audit')
              )}

              <div className="audit-note">{rule.note}</div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm" onClick={onClose}>
            关闭
          </button>
          {tab === 'audit' && images.length > 0 ? (
            <button className="btn btn-sm" onClick={startAudit} disabled={auditing}>
              {auditing ? <span className="spinner dark" /> : null}
              {auditing ? `体检中 ${auditDone}/${images.length}…` : audited ? '重查一遍' : '开始体检'}
            </button>
          ) : null}
          {tab === 'export' ? (
            <button className="btn btn-primary btn-sm" onClick={exportAll} disabled={busy || images.length === 0}>
              {busy ? <span className="spinner dark" /> : null}
              {busy ? `正在导出 ${done}/${images.length}…` : `导出（${images.length} 张）`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
