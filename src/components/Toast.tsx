import { useCallback, useState } from 'react'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

export function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev.slice(-2), { id, text, kind }])
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, kind === 'error' ? 4200 : 2400)
  }, [])

  return { items, push }
}

export function ToastLayer({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-layer">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : t.kind === 'success' ? 'success' : ''}`}>
          {t.kind === 'error' ? '✕' : t.kind === 'success' ? '✓' : '·'}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
