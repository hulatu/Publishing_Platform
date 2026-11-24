import { useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../hooks/useFocusTrap'

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

/**
 * 统一弹层外壳。
 *
 * 除了视觉遮罩，这里还负责键盘和读屏用户真正需要的几件事：
 * 焦点移入、Tab 循环、Esc 关闭、背景 inert、关闭后恢复触发按钮。
 * 这套行为抽在 hooks/useFocusTrap 里，和移动端侧栏抽屉共用。
 *
 * 必须 portal 到 body：焦点陷阱会把 `.app > .topbar` 和 `.app > .app-body`
 * 设为 inert，而主题选择器（ThemePicker）就长在 `.app-body` 里 ——
 * 不 portal 的话，弹层自己成了 inert 祖先的后代，整层点不动、也关不掉。
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
  /**
   * 只有「按在遮罩上、也在遮罩上松开」才算点了遮罩。
   *
   * 原来只看 click 的目标：在弹层里按住鼠标（比如拖选一段摘要文字）、
   * 拖到遮罩上松手，click 的目标就是遮罩 —— 弹层直接关掉，刚改的东西没了。
   */
  const downOnMask = useRef(false)

  useFocusTrap({
    active: open,
    containerRef: dialogRef,
    backgroundSelector: '.app > .topbar, .app > .app-body',
    onEscape: onClose,
  })

  if (!open) return null

  const stop = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation()

  return createPortal(
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
    </div>,
    document.body,
  )
}
