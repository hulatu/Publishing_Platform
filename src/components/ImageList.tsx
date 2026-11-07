/**
 * 正文图片清单
 *
 * 公众号正文里的图片必须来自微信自己的图床（mmbiz.qpic.cn），外链图会被直接过滤。
 * 这一步就是把文章里的图按出现顺序列出来、按 01.jpg 这样的序号打包下载，
 * 用户拖进公众号编辑器再传一遍就行，不用回去翻原文章一张张存。
 *
 * 跨域是常态：图床没开 CORS 时 fetch 会失败，这时退化成「打开原图」逐张存。
 */

import { useMemo, useState } from 'react'
import type { ImageRef } from '../core/ir'
import { mapLimit } from '../core/async'
import { downloadBlob } from '../cards/export'
import { safeFileName } from '../cards/export'

interface Props {
  open: boolean
  onClose: () => void
  images: ImageRef[]
  title: string
}

type Status = 'idle' | 'busy' | 'ok' | 'fail'

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
    return await fetchImageOnce(url)
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError'
    if (!isTimeout) throw err
    return await fetchImageOnce(url)
  }
}

export function ImageList({ open, onClose, images, title }: Props) {
  const [status, setStatus] = useState<Record<string, Status>>({})
  /** <img> 自身加载失败（链接失效、防盗链），和「跨域打不进包」是两回事 */
  const [broken, setBroken] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState(false)
  /** 已处理完的张数，用于「3 / 20」进度 */
  const [done, setDone] = useState(0)
  /** 打包阶段（不是下载阶段）的失败原因 */
  const [error, setError] = useState('')

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

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal img-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">正文图片</div>
            <div className="ledger-sub">共 {images.length} 张 · 按文中出现顺序编号</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="notice notice-info" style={{ marginBottom: 14 }}>
            <span className="notice-mark">i</span>
            <span>
              公众号正文的图片必须来自微信自己的图床，外链图会被过滤掉。
              打包下载后按序号拖进编辑器重新上传即可。
            </span>
          </div>

          {images.length === 0 ? (
            <div className="check-empty" style={{ padding: '30px 0' }}>
              这篇文章里没有图片。
            </div>
          ) : (
            <div className="img-grid">
              {images.map((img, i) => {
                const s = status[img.src] ?? 'idle'
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
                      {s === 'ok' ? <span className="img-badge ok">✓</span> : null}
                      {s === 'fail' ? <span className="img-badge fail">跨域</span> : null}
                      {s === 'busy' ? <span className="img-badge busy">…</span> : null}
                    </div>
                    <div className="img-meta">
                      <span className="img-alt" title={img.alt || img.src}>
                        {img.alt || '（无说明文字）'}
                      </span>
                      <a className="img-open" href={img.src} target="_blank" rel="noreferrer">
                        打开原图
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
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
              <span>{failed} 张图所在站点没开跨域，没法打包；点每张下面的「打开原图」另存即可。</span>
            </div>
          ) : null}
        </div>

        <div className="modal-foot">
          <button className="btn btn-sm" onClick={onClose}>
            关闭
          </button>
          <button className="btn btn-primary btn-sm" onClick={downloadAll} disabled={busy || images.length === 0}>
            {busy ? <span className="spinner dark" /> : null}
            {busy ? `正在打包 ${done}/${images.length}…` : `打包下载（${images.length} 张）`}
          </button>
        </div>
      </div>
    </div>
  )
}
