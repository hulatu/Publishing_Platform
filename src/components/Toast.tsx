/**
 * 浮层提示
 *
 * 两条无障碍上的硬要求，之前都没满足：
 *
 * 1. **能关**。WCAG 2.2.1 要求有自动消失的提示也必须能被暂停或关掉 ——
 *    原来的 2.4 秒对「已复制富文本，直接粘进编辑器即可 · 已记为待发布」这种
 *    句子是真的读不完，而读屏用户更没法把它叫回来重听。
 * 2. **错误不自动消失**。复制失败、存储写不进去，这类消息用户得能盯着看，
 *    边看边去处理（删草稿、清配额），自己决定什么时候关。
 *
 * 实现上没有用「一个 setTimeout 定生死」：那样一悬停就没法续期。这里自己记
 * 每条还剩多久，悬停 / 聚焦时停表，移开再接着走。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

/** 0 表示不自动消失 */
const AUTO_DISMISS: Record<ToastKind, number> = { info: 3200, success: 3200, error: 0 }

/** 同时最多显示几条。超出时挤掉最早的那条（连同它的计时器） */
const MAX_VISIBLE = 3

interface TimerState {
  handle: number | null
  /** 还剩多少毫秒 */
  remaining: number
  /** 当前这段计时是什么时候开始的 */
  since: number
}

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<number, TimerState>())

  const stopTimer = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t?.handle) window.clearTimeout(t.handle)
    timers.current.delete(id)
  }, [])

  const dismiss = useCallback(
    (id: number) => {
      stopTimer(id)
      setItems((prev) => prev.filter((t) => t.id !== id))
    },
    [stopTimer],
  )

  const push = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      const id = Date.now() + Math.random()
      const item: ToastItem = { id, text, kind }

      setItems((prev) => {
        const next = [...prev, item].slice(-MAX_VISIBLE)
        // 被挤出可见区的那条，计时器也要收掉，否则它到点了还会去 setItems
        const kept = new Set(next.map((t) => t.id))
        for (const t of prev) if (!kept.has(t.id)) stopTimer(t.id)
        return next
      })

      const ms = AUTO_DISMISS[kind]
      if (ms <= 0) return
      const state: TimerState = { handle: null, remaining: ms, since: Date.now() }
      state.handle = window.setTimeout(() => dismiss(id), ms)
      timers.current.set(id, state)
    },
    [dismiss, stopTimer],
  )

  /** 悬停 / 聚焦：停表，把已经走过的时间从剩余里扣掉 */
  const pause = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (!t || t.handle === null) return
    window.clearTimeout(t.handle)
    t.remaining = Math.max(0, t.remaining - (Date.now() - t.since))
    t.handle = null
  }, [])

  /** 移开：接着走完剩下的时间 */
  const resume = useCallback(
    (id: number) => {
      const t = timers.current.get(id)
      if (!t || t.handle !== null) return
      if (t.remaining <= 0) {
        dismiss(id)
        return
      }
      t.since = Date.now()
      t.handle = window.setTimeout(() => dismiss(id), t.remaining)
    },
    [dismiss],
  )

  // 卸载（其实不会发生，App 是根组件）时别留下悬空计时器
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) if (t.handle) window.clearTimeout(t.handle)
    }
  }, [])

  return { items, push, dismiss, pause, resume }
}

const MARK: Record<ToastKind, string> = { info: '·', success: '✓', error: '✕' }

export function ToastLayer({
  items,
  onDismiss,
  onPause,
  onResume,
}: {
  items: ToastItem[]
  onDismiss: (id: number) => void
  onPause: (id: number) => void
  onResume: (id: number) => void
}) {
  return (
    <div
      className="toast-layer"
      role="region"
      aria-live="polite"
      aria-atomic="false"
      aria-label="操作通知"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast ${t.kind === 'error' ? 'error' : t.kind === 'success' ? 'success' : ''}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => onPause(t.id)}
          onMouseLeave={() => onResume(t.id)}
          onFocus={() => onPause(t.id)}
          onBlur={() => onResume(t.id)}
        >
          {/* 符号本身没有信息量，念出来只会变成「✕ 复制失败」 */}
          <span aria-hidden>{MARK[t.kind]}</span>
          <span>{t.text}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭这条通知"
            onClick={() => onDismiss(t.id)}
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      ))}
    </div>
  )
}
