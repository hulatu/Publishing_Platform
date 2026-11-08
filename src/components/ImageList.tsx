/**
 * 正文图片清单
 *
 * 三个用途，都挂在同一个面板上：
 * 1. 体检 —— 发布前查一遍「能不能取到 / 别的站引用会不会被拒 / 多大 / 什么格式」；
 * 2. 打包下载 —— 按 01.jpg 这样的序号拿一份原图（备份、换图床、传别的平台）；
 * 3. 传图床 —— 把 md 里的本地路径换成能外链的地址。
 *
 * 顺序就是使用顺序：先体检，再决定要不要折腾。
 *
 * 不再假设「公众号必须 mmbiz.qpic.cn」：实测自建图床的外链在公众号正文里显示正常，
 * 所以这里不劝人重传，只把事实摆出来。
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
import type { AssetFile } from '../core/local-assets'
import { HostUploader } from './HostUploader'
import {
  auditImage,
  fmtBytes,
  imageRule,
  mimeExt,
  summarize,
  type AuditRow,
  type ImageIssue,
} from '../core/image-audit'

interface Props {
  open: boolean
  onClose: () => void
  images: ImageRef[]
  title: string
  /** 当前平台，决定体检用哪套阈值（公众号禁 SVG、小红书要 3:4） */
  platform: string
  /** 同一个文件夹里拖进来的本地图片，传图床要用 */
  assets: AssetFile[]
  /** 上传完成：把正文里的本地路径换成图床地址 */
  onUploaded: (mapping: Map<string, string>) => void
  onAddAssets: (assets: AssetFile[]) => void
  onOpenSettings: () => void
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void
}

type Status = 'idle' | 'busy' | 'ok' | 'fail'
type Tab = 'audit' | 'download' | 'host'

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

function extOf(blob: Blob, url: string): string {
  const byType = EXT[blob.type.toLowerCase()]
  if (byType) return byType
  const m = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url)
  return m ? m[1].toLowerCase() : 'jpg'
}

/**
 * 并发度。浏览器同域本来就允许 6 个连接，串行等于只用了 1/6；
 * 取 3 而不是 6，是不想同时向同一个图床开满连接 —— 容易被当成爬虫。
 */
const IMAGE_CONCURRENCY = 3

const IMAGE_TIMEOUT = 15_000

/**
 * 同源图片代理。图床只服务 `<img>`、不发 Access-Control-Allow-Origin 时，
 * fetch 会被浏览器拦掉；`<img>` 却照常显示 —— 所以「预览正常、下载全红」。
 * 这个路径由 Pages Function 转发并补上 CORS 头。
 */
const PROXY = '/api/img?u='

async function fetchImageOnce(url: string): Promise<Blob> {
  // AbortSignal.timeout 在 Safari 16 以下没有，直接用会抛 TypeError，
  // 结果被当成「跨域失败」—— 提示全错。手动兜一层。
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), IMAGE_TIMEOUT)
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) throw new Error('不是图片')
    return blob
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 超时重试一次。
 *
 * 只重试超时：CORS 被拦和网络失败在浏览器里都是同一个 TypeError，
 * 分不出来，重试也是白等 15 秒。而超时是明确信号 —— 图床慢一下很常见。
 */
async function fetchImage(url: string): Promise<Blob> {
  try {
    try {
      return await fetchImageOnce(url)
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError'
      if (!isTimeout) throw err
      return await fetchImageOnce(url)
    }
  } catch {
    // 直连不行就走同源代理再试一次。
    // 代理不可用时（本地没跑 Functions、域名不在白名单）这里会再抛，
    // 由上层把这张标成「跨域」。
    return await fetchImageOnce(PROXY + encodeURIComponent(url))
  }
}

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

export function ImageList({
  open,
  onClose,
  images,
  title,
  platform,
  assets,
  onUploaded,
  onAddAssets,
  onOpenSettings,
  onToast,
}: Props) {
  /** 打包下载 / 传图床 / 体检 —— 同一批图片的几件事，放一个面板里省几个顶栏入口 */
  const [tab, setTab] = useState<Tab>('audit')
  const [status, setStatus] = useState<Record<string, Status>>({})
  /** <img> 自身加载失败（链接失效、防盗链），和「跨域打不进包」是两回事 */
  const [broken, setBroken] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState(false)
  /** 已处理完的张数，用于「3 / 20」进度 */
  const [done, setDone] = useState(0)
  /** 打包阶段（不是下载阶段）的失败原因 */
  const [error, setError] = useState('')

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

  const downloadAll = async () => {
    if (images.length === 0 || busy) return
    setBusy(true)
    setStatus({})
    setDone(0)
    setError('')

    let ok = 0

    try {
      // 并发拉图。命名放在最后按原顺序做 —— 并发是乱序完成的，
      // 边下边编号会把 03 号图存成 01。
      const blobs = await mapLimit(images, IMAGE_CONCURRENCY, async (img) => {
        setOne(img.src, 'busy')
        try {
          const blob = await fetchImage(img.src)
          setOne(img.src, 'ok')
          ok++
          return blob
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

      images.forEach((img, i) => {
        const blob = blobs[i]
        if (!blob) return
        folder.file(`${String(i + 1).padStart(2, '0')}.${extOf(blob, img.src)}`, blob)
      })

      const out = await zip.generateAsync({ type: 'blob' })
      downloadBlob(out, `${safeFileName(title)}-正文图片.zip`)
    } catch (e) {
      // 图下好了却打包失败（图太大、内存不够）以前是静默什么都不发生，
      // 用户会以为是没点到按钮
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /** 缩略图 + 元信息。体检和打包下载共用，区别只在右上角那个角标。 */
  const grid = (mode: 'audit' | 'download') => (
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
              {mode === 'download' && s === 'ok' ? <span className="img-badge ok">✓</span> : null}
              {mode === 'download' && s === 'fail' ? <span className="img-badge fail">跨域</span> : null}
              {mode === 'download' && s === 'busy' ? <span className="img-badge busy">…</span> : null}
            </div>
            <div className="img-meta">
              <span className="img-alt" title={img.alt || img.src}>
                {img.alt || '（无说明文字）'}
              </span>
              {mode === 'audit' && facts ? <span className="img-facts">{facts}</span> : null}
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
            <button className={tab === 'download' ? 'active' : ''} onClick={() => setTab('download')}>
              打包下载
            </button>
            <button className={tab === 'host' ? 'active' : ''} onClick={() => setTab('host')}>
              传图床
            </button>
          </div>

          {tab === 'host' ? (
            <HostUploader
              images={images}
              assets={assets}
              onUploaded={onUploaded}
              onAddAssets={onAddAssets}
              onOpenSettings={onOpenSettings}
              onToast={onToast}
            />
          ) : tab === 'download' ? (
            <>
              <div className="notice notice-info" style={{ marginBottom: 14 }}>
                <span className="notice-mark">i</span>
                <span>
                  按正文出现顺序编号。打包下载可以一次拿到全部原图；
                  切到「传图床」能把 md 里的本地图片换成外链地址。
                </span>
              </div>

              {images.length === 0 ? (
                <div className="check-empty" style={{ padding: '30px 0' }}>
                  这篇文章里没有图片。
                </div>
              ) : (
                grid('download')
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
                    {failed} 张图所在站点没开跨域，代理也没放行（域名不在{' '}
                    <code>functions/api/img.ts</code> 的白名单里）；点每张下面的「打开原图」另存即可。
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
          {tab === 'download' ? (
            <button className="btn btn-primary btn-sm" onClick={downloadAll} disabled={busy || images.length === 0}>
              {busy ? <span className="spinner dark" /> : null}
              {busy ? `正在打包 ${done}/${images.length}…` : `打包下载（${images.length} 张）`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
