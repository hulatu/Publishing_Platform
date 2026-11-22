/**
 * PWA 更新提示
 *
 * `public/sw.js` 不再在 install 里 skipWaiting —— 写作工具经常一开就是一整天，
 * 新 SW 立刻接管并删旧缓存，会让旧页面随后懒加载的 chunk 找不到。
 *
 * 这里只做三件事：
 * - 生产环境注册 SW；
 * - 发现有 waiting worker 时把 `updateReady` 置真；
 * - 用户点“新版本”后发 SKIP_WAITING，等 controllerchange 再刷新。
 *
 * 开发环境不注册：SW 会缓存 Vite 的模块请求，改代码不生效。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export function useAppUpdate(): {
  updateReady: boolean
  applyUpdate: () => void
} {
  const [updateReady, setUpdateReady] = useState(false)
  const registration = useRef<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

    let cancelled = false
    let watching: ServiceWorker | null = null

    const noteWaiting = (reg: ServiceWorkerRegistration) => {
      // controller 为 null 表示这是第一次安装，不是“更新”，不该提示。
      if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true)
    }

    const watchInstalling = (reg: ServiceWorkerRegistration) => {
      const worker = reg.installing
      if (!worker || worker === watching) return
      watching = worker
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          setUpdateReady(true)
        }
      })
    }

    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        if (cancelled) return
        registration.current = reg
        noteWaiting(reg)
        watchInstalling(reg)
        reg.addEventListener('updatefound', () => watchInstalling(reg))
        // 浏览器通常只在导航时检查更新；长标签页主动查一次。
        reg.update().catch(() => {})
      })
      .catch(() => {
        // 注册失败不影响在线使用，静默即可
      })

    return () => {
      cancelled = true
    }
  }, [])

  const applyUpdate = useCallback(() => {
    const waiting = registration.current?.waiting
    if (!waiting) {
      window.location.reload()
      return
    }

    let reloaded = false
    const reload = () => {
      if (reloaded) return
      reloaded = true
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
    waiting.postMessage({ type: 'SKIP_WAITING' })
    // 个别浏览器 controllerchange 不触发，兜底刷新
    window.setTimeout(reload, 1500)
  }, [])

  return { updateReady, applyUpdate }
}
