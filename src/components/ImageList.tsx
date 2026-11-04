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
import JSZip from 'jszip'
import type { ImageRef } from '../core/ir'
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

async function fetchImage(url: string): Promise<Blob> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
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

export function ImageList({ open, onClose, images, title }: Props) {
  const [status, setStatus] = useState<Record<string, Status>>({})
  /** <img> 自身加载失败（链接失效、防盗链），和「跨域打不进包」是两回事 */
  const [broken, setBroken] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState(false)

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

    const zip = new JSZip()
    const folder = zip.folder('images') ?? zip
    let ok = 0
    let fail = 0

    for (let i = 0; i < images.length; i++) {
      const img = images[i]
      const name = String(i + 1).padStart(2, '0')
      setOne(img.src, 'busy')
      try {
        const blob = await fetchImage(img.src)
        folder.file(`${name}.${extOf(blob, img.src)}`, blob)
        setOne(img.src, 'ok')
        ok++
      } catch {
        setOne(img.src, 'fail')
        fail++
      }
    }

    setBusy(false)

    if (ok === 0) return
    const out = await zip.generateAsync({ type: 'blob' })
    downloadBlob(out, `${safeFileName(title)}-正文图片.zip`)
    if (fail > 0) {
      // 失败的那几张给用户手动存的入口，不静默吞掉
      console.warn(`[image-list] ${fail} 张因跨域无法打包`)
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
            {busy ? '正在打包…' : `打包下载（${images.length} 张）`}
          </button>
        </div>
      </div>
    </div>
  )
}
