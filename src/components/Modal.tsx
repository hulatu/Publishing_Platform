import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  /** 读屏时播报的弹层名称；视觉标题仍由各面板自己渲染 */
  label: string
  children: ReactNode
  className?: string
  /** 主题墙等非标准宽度弹层可以换掉默认的 .modal 外壳 */
  shellClass?: string
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.offsetParent !== null,
  )
}

/**
 * 统一弹层外壳。
 *
 * 除了视觉遮罩，这里还负责键盘和读屏用户真正需要的几件事：
 * 焦点移入、Tab 循环、Esc 关闭、背景 inert、关闭后恢复触发按钮。
 * 样式仍由调用方决定，主题墙这类非标准面板通过 shellClass 复用同一套行为。
 */
export function Modal({
  open,
  onClose,
  label,
  children,
  className = '',
  shellClass = 'modal',
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  /**
   * 只有「按在遮罩上、也在遮罩上松开」才算点了遮罩。
   *
   * 原来只看 click 的目标：在弹层里按住鼠标（比如拖选一段摘要文字）、
   * 拖到遮罩上松手，click 的目标就是遮罩 —— 弹层直接关掉，刚改的东西没了。
   */
  const downOnMask = useRef(false)

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const backgrounds = [
      ...document.querySelectorAll<HTMLElement>('.app > .topbar, .app > .app-body'),
    ]
    const previousA11y = backgrounds.map((el) => ({
      el,
      ariaHidden: el.getAttribute('aria-hidden'),
      inert: el.inert,
    }))

    for (const el of backgrounds) {
      el.setAttribute('aria-hidden', 'true')
      el.inert = true
    }

    // 先落在弹层容器上，读屏会先读标题；继续按 Tab 再进入第一个控件。
    dialog.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusableIn(dialog)
      if (items.length === 0) {
        event.preventDefault()
        dialog.focus({ preventScroll: true })
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      for (const { el, ariaHidden, inert } of previousA11y) {
        if (ariaHidden === null) el.removeAttribute('aria-hidden')
        else el.setAttribute('aria-hidden', ariaHidden)
        el.inert = inert
      }
      if (previous?.isConnected) {
        // 菜单项触发弹层时，关闭后 <details> 也收起了，原按钮已不可见；
        // 这时把焦点还给菜单触发器，不要让它掉到页面根节点。
        const explicitReturn = previous.dataset.returnFocus
          ? document.querySelector<HTMLElement>(previous.dataset.returnFocus)
          : null
        const hiddenMenuTrigger =
          previous.offsetParent === null
            ? previous.closest('details')?.querySelector<HTMLElement>('summary')
            : null
        const target = explicitReturn ?? hiddenMenuTrigger ?? previous
        target.focus({ preventScroll: true })
      }
    }
  }, [open])

  if (!open) return null

  const stop = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation()

  return (
    <div
      className="modal-mask"
      onMouseDown={(event) => {
        downOnMask.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (downOnMask.current && event.target === event.currentTarget) onClose()
        downOnMask.current = false
      }}
    >
      <div
        ref={dialogRef}
        className={`${shellClass} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={stop}
      >
        {children}
      </div>
    </div>
  )
}
