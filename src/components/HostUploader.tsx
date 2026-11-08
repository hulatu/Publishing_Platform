/**
 * 正文图片 → 图床
 *
 * 这个面板只做一件事：把「本地路径」的图片传上去，换成能外链的地址。
 * 已经在网上的（http/https/协议相对）一律标成「已外链」不动 —— 这就是
 * 使用者说的「本来就在图床上，就用原有链接」。
 *
 * 三种状态必须一眼分得清，因为它们要做的事完全不同：
 *   - 已外链：什么都不用做
 *   - 待上传：本地文件在手上，点一下就行
 *   - 缺文件：md 里写了路径，但这次没把图片拖进来 —— 得补选，不能假装能传
 *
 * 上传成功后立刻应用到正文，不留「再点一次确认」这一步：
 * 用户点「上传」的意图已经明确，多一次确认只是多一次误操作的机会。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImageRef } from '../core/ir'
import { classifySrc, loadHostConfig, normalizeSrc, uploadImage, hostReady, hostLabels, type HostConfig } from '../core/image-host'
import { collectAssets, isImageFile, matchAsset, type AssetFile } from '../core/local-assets'
import { mapLimit } from '../core/async'

interface Props {
  images: ImageRef[]
  assets: AssetFile[]
  /** 上传成功：把 md 里的旧地址换成新地址 */
  onUploaded: (mapping: Map<string, string>) => void
  /** 补选的图片合并进 assets */
  onAddAssets: (assets: AssetFile[]) => void
  onOpenSettings: () => void
  onToast: (message: string, kind?: 'success' | 'error' | 'info') => void
}

type RowState = 'remote' | 'ready' | 'missing'

/** 图床并发：多数免费图床对连续请求很敏感，2 个刚好，再多容易撞限流 */
const UPLOAD_CONCURRENCY = 2

export function HostUploader({ images, assets, onUploaded, onAddAssets, onOpenSettings, onToast }: Props) {
  const cfg: HostConfig = useMemo(() => loadHostConfig(), [])
  const ready = hostReady(cfg)

  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [busySrc, setBusySrc] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  /** 本地文件的预览地址：URL.createObjectURL 不释放会一直占着内存 */
  const previews = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of assets) map.set(a.path, URL.createObjectURL(a.file))
    return map
  }, [assets])

  useEffect(() => {
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url)
    }
  }, [previews])

  const rows = useMemo(() => {
    return images.map((img) => {
      const kind = classifySrc(img.src)
      if (kind === 'remote') return { img, state: 'remote' as RowState, asset: null, preview: '' }
      const asset = matchAsset(normalizeSrc(img.src), assets)
      return {
        img,
        state: (asset ? 'ready' : 'missing') as RowState,
        asset,
        preview: asset ? (previews.get(asset.path) ?? '') : '',
      }
    })
  }, [images, assets, previews])

  const pending = rows.filter((r) => r.state === 'ready')
  const missing = rows.filter((r) => r.state === 'missing')
  const remote = rows.filter((r) => r.state === 'remote')

  const doUpload = async (targets: typeof rows) => {
    if (!ready) {
      onToast(`图床还没配好：${hostLabels[cfg.kind]} 的必填项不完整`, 'info')
      return
    }
    if (targets.length === 0) return

    setBusy(true)
    setDone(0)
    setFailed({})

    const mapping = new Map<string, string>()

    await mapLimit(targets, UPLOAD_CONCURRENCY, async (row) => {
      if (!row.asset) return
      setBusySrc(row.img.src)
      try {
        const { url } = await uploadImage(row.asset.file, cfg)
        mapping.set(row.img.src, url)
      } catch (e) {
        setFailed((prev) => ({
          ...prev,
          [row.img.src]: e instanceof Error ? e.message : String(e),
        }))
      } finally {
        setDone((n) => n + 1)
      }
    })

    setBusySrc('')
    setBusy(false)

    if (mapping.size > 0) {
      onUploaded(mapping)
      onToast(`已上传 ${mapping.size} 张，正文里的链接已替换`, 'success')
    }
    if (mapping.size < targets.length) {
      onToast(`${targets.length - mapping.size} 张没传上去，看下面的原因`, 'error')
    }
  }

  const addFiles = (files: File[]) => {
    const added = collectAssets(files)
    if (added.length === 0) {
      onToast('这批文件里没有图片', 'error')
      return
    }
    onAddAssets(added)
    onToast(`补进 ${added.length} 张图片，重新匹配一下`)
  }

  return (
    <>
      {!ready ? (
        <div className="notice notice-warn">
          <span className="notice-mark">!</span>
          <span>
            还没配图床。去{' '}
            <button className="link-btn" onClick={onOpenSettings}>
              设置 → 图床
            </button>{' '}
            选一个（imgbb 填个免费 Key 就能用）。
          </span>
        </div>
      ) : null}

      <div className="host-summary">
        <span className="host-chip remote">已外链 {remote.length}</span>
        <span className="host-chip ready">待上传 {pending.length}</span>
        <span className={`host-chip ${missing.length > 0 ? 'missing' : ''}`}>缺文件 {missing.length}</span>
        <button className="link-btn" onClick={() => fileRef.current?.click()}>
          补选图片
        </button>
      </div>

      {images.length === 0 ? (
        <div className="check-empty" style={{ padding: '30px 0' }}>
          这篇文章里没有图片。
        </div>
      ) : (
        <div className="img-grid">
          {rows.map((row, i) => {
            const src = row.preview || row.img.src
            const err = failed[row.img.src]
            return (
              <div className="img-item" key={row.img.src}>
                <div className="img-thumb">
                  {/* 「缺文件」时不能渲染 <img>：src 指向一个不存在的本地路径，
                      浏览器会把 alt 文字画在缩略图左上角，正好压住序号角标。
                      缩略图是装饰性的，说明文字就在下面，所以 alt 留空。 */}
                  {row.state === 'missing' ? (
                    <span className="img-thumb-empty">缺图片文件</span>
                  ) : (
                    <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" />
                  )}
                  <span className="img-index">{String(i + 1).padStart(2, '0')}</span>
                  {row.state === 'remote' ? <span className="img-badge ok">已外链</span> : null}
                  {row.state === 'missing' ? <span className="img-badge fail">缺文件</span> : null}
                  {busySrc === row.img.src ? <span className="img-badge busy">…</span> : null}
                </div>
                <div className="img-meta">
                  <span className="img-alt" title={row.img.src}>
                    {row.img.alt || '（无说明文字）'}
                  </span>
                  <span className="img-host-state">
                    {row.state === 'remote'
                      ? '原本就在网上，保留原链接'
                      : row.state === 'ready'
                        ? row.asset?.path
                        : '这次没拖进这张图'}
                  </span>
                </div>
                {err ? <div className="img-host-err">{err}</div> : null}
              </div>
            )
          })}
        </div>
      )}

      {missing.length > 0 ? (
        <div className="notice notice-warn" style={{ marginTop: 12 }}>
          <span className="notice-mark">!</span>
          <span>
            有 {missing.length} 张图在 md 里写了路径，但这次没把文件拖进来。点「补选图片」把
            images 目录里的图选上，或者重新拖整个文件夹。
          </span>
        </div>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].filter(isImageFile)
          if (files.length > 0) addFiles(files)
          e.target.value = ''
        }}
      />

      <div className="host-actions">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => void doUpload(pending)}
          disabled={busy || !ready || pending.length === 0}
        >
          {busy ? <span className="spinner dark" /> : null}
          {busy ? `正在上传 ${done}/${pending.length}…` : `全部上传（${pending.length} 张）`}
        </button>
      </div>
    </>
  )
}
