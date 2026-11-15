/**
 * 故障排查
 *
 * 把分散在 AI、图片、本地存储和复制流程里的恢复入口放进一个低频面板。
 * 它不自动修复任何东西，只告诉用户当前状态和下一步能点哪里。
 */

import { useEffect, useState } from 'react'
import { Modal } from './Modal'

interface Props {
  open: boolean
  onClose: () => void
  providerReady: boolean
  imageCount: number
  onOpenSettings: () => void
  onOpenImages: () => void
  onOpenDrafts: () => void
}

export function RecoverySheet({
  open,
  onClose,
  providerReady,
  imageCount,
  onOpenSettings,
  onOpenImages,
  onOpenDrafts,
}: Props) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const [storageOk, setStorageOk] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open) return
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)

    try {
      localStorage.setItem('ad.recovery-probe', '1')
      localStorage.removeItem('ad.recovery-probe')
      setStorageOk(true)
    } catch {
      setStorageOk(false)
    }

    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [open])

  const run = (action: () => void) => {
    onClose()
    action()
  }

  return (
    <Modal open={open} onClose={onClose} label="故障排查" className="recovery-modal">
      <div className="modal-head">
        <div>
          <div className="modal-title">故障排查</div>
          <div className="ledger-sub">检查常见依赖，并进入对应的修复位置。</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <div className="modal-body recovery-body">
        <div className={`recovery-row ${online ? 'ok' : 'error'}`}>
          <span className="recovery-mark" aria-hidden />
          <div>
            <strong>网络</strong>
            <p>{online ? '浏览器在线。' : '当前处于离线状态，AI 和图片请求会失败。'}</p>
          </div>
        </div>

        <div className={`recovery-row ${storageOk === false ? 'error' : storageOk ? 'ok' : 'note'}`}>
          <span className="recovery-mark" aria-hidden />
          <div className="recovery-row-copy">
            <strong>本地保存</strong>
            <p>
              {storageOk === false
                ? '浏览器拒绝写入本地存储，草稿和台账可能无法保存。'
                : storageOk
                  ? '本地存储可写入，草稿和台账保存在当前浏览器。'
                  : '正在检查本地存储…'}
            </p>
          </div>
          <button className="btn btn-sm" onClick={() => run(onOpenDrafts)}>
            草稿箱
          </button>
        </div>

        <div className={`recovery-row ${providerReady ? 'ok' : 'note'}`}>
          <span className="recovery-mark" aria-hidden />
          <div className="recovery-row-copy">
            <strong>AI 服务</strong>
            <p>{providerReady ? '模型配置可用。' : '还没有配置模型，AI 平台会使用本地组装。'}</p>
          </div>
          <button className="btn btn-sm" onClick={() => run(onOpenSettings)}>
            打开设置
          </button>
        </div>

        <div className={`recovery-row ${imageCount > 0 ? 'note' : 'ok'}`}>
          <span className="recovery-mark" aria-hidden />
          <div className="recovery-row-copy">
            <strong>图片</strong>
            <p>{imageCount > 0 ? `正文共 ${imageCount} 张图片，可以重新体检。` : '当前文章没有正文图片。'}</p>
          </div>
          {imageCount > 0 ? (
            <button className="btn btn-sm" onClick={() => run(onOpenImages)}>
              图片体检
            </button>
          ) : null}
        </div>

        <div className="recovery-note">
          如果复制失败，先回到本页点击任意位置，再重新复制。仍然失败时刷新页面后会保留自动保存的草稿。
        </div>
      </div>

      <div className="modal-foot">
        <button className="btn" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      </div>
    </Modal>
  )
}
