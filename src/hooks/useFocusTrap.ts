/**
 * 焦点陷阱：弹层和移动端侧栏抽屉共用这一份实现。
 *
 * 原来这套逻辑只写在 Modal.tsx 里。侧栏抽屉在窄屏是覆盖层，同样需要
 * 「背景 inert / Tab 循环 / Esc 关闭 / 焦点归还」，但它的容器是常驻的
 * `<aside>`，不是 portal 出来的弹层 —— 所以把行为抽成 hook，两边各自传入
 * 容器和背景选择器，不另写一套。
 */

import { useLayoutEffect, useRef, type RefObject } from 'react'

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

interface Options {
  /** 是否启用陷阱 */
  active: boolean
  /** 焦点被困住的容器（弹层本体 / 侧栏） */
  containerRef: RefObject<HTMLElement | null>
  /** 需要设为 inert 的背景元素，必须不含容器自身 */
  backgroundSelector: string
  /** Esc 时做什么；不传则不拦截 Esc */
  onEscape?: () => void
  /** 关闭后把焦点还给谁；不传则还给打开前的 activeElement */
  returnFocusRef?: RefObject<HTMLElement | null>
  /**
   * always：无条件归还（弹层）
   * when-inside：只在焦点还在陷阱内 / body 上时归还（抽屉）
   *   —— 选中平台后调用方会把焦点移到页面标题，不能被归还逻辑抢回来
   */
  restoreFocus?: 'always' | 'when-inside'
  /** 已有 role=dialog 打开时暂停，避免和弹层抢 Tab / Esc */
  pauseWhileDialogOpen?: boolean
  /** 打开时聚焦容器本身（读屏先读名称）还是第一个可聚焦项 */
  initialFocus?: 'container' | 'first'
}

export function useFocusTrap({
  active,
  containerRef,
  backgroundSelector,
  onEscape,
  returnFocusRef,
  restoreFocus = 'always',
  pauseWhileDialogOpen = false,
  initialFocus = 'container',
}: Options): void {
  // 用 ref 存回调：调用方每次渲染传新函数时，陷阱不会被反复重建
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  /**
   * 每次启用 / 重新启用陷阱都换一代。延迟的聚焦回调只在「还是这一代」时执行，
   * 避免抽屉刚关上又打开时，上一代把焦点抢回去。
   */
  const epochRef = useRef(0)
  /**
   * 打开前的焦点元素。只在「当前焦点不在容器里」时记录：
   * StrictMode 会把 effect 跑两遍，第二遍开始时焦点已经被第一遍移进容器，
   * 若照抄 activeElement 就会把弹层自己当成「来源」，关闭后无处可还。
   */
  const previousRef = useRef<HTMLElement | null>(null)

  /**
   * 用 layout effect 而不是 effect：inert 必须在 commit 阶段就应用/撤销。
   * 抽屉关闭时调用方会在同一帧的 rAF 里把焦点移到页面标题；如果 inert
   * 拖到 passive effect 才撤销，那一帧标题仍不可聚焦，焦点就丢了。
   */
  useLayoutEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    const epoch = ++epochRef.current
    const activeAtStart = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!activeAtStart || !container.contains(activeAtStart)) previousRef.current = activeAtStart
    const previous = previousRef.current
    // 在 effect 里取当前值：清理函数运行时 ref 可能已经被换掉，提前固定下来
    const returnTarget = returnFocusRef?.current ?? null
    const backgrounds = [...document.querySelectorAll<HTMLElement>(backgroundSelector)]
    const previousA11y = backgrounds.map((el) => ({
      el,
      ariaHidden: el.getAttribute('aria-hidden'),
      inert: el.inert,
    }))

    for (const el of backgrounds) {
      el.setAttribute('aria-hidden', 'true')
      el.inert = true
    }

    // 先落在容器上，读屏会先读名称；继续按 Tab 再进入第一个控件。
    const first = focusableIn(container)[0]
    const initial = initialFocus === 'first' ? first ?? container : container
    // 抽屉是在同一帧里从 visibility:hidden 切成 visible 的。先读一次计算样式，
    // 强制新样式落地；否则 focus() 可能仍按旧样式判定「不可聚焦」而静默失败。
    // （只读 offsetHeight 不够：focus 的可聚焦判定看的是 visibility。）
    void getComputedStyle(initial).visibility
    initial.focus({ preventScroll: true })

    /**
     * 首次聚焦失败时补两次。
     *
     * 两个已知的抢焦点来源：
     * 1. 键盘 Enter 激活抽屉按钮时，Chrome 会在我们的 layout effect 之后
     *    再 focusElementForAction，把焦点放回按钮；
     * 2. 样式切换那一帧，抽屉刚从 visibility:hidden 变 visible。
     * 下一个任务样式已稳定、按钮默认动作也已结束，这时再聚焦就能落下。
     * 用 setTimeout 而不是 rAF：页面在后台时 rAF 会被暂停，焦点会一直悬着。
     */
    let focusRetry = 0
    let focusRetry2 = 0
    const retryInitialFocus = () => {
      if (epochRef.current !== epoch) return
      if (document.activeElement === initial) return
      // 用户已经自己 Tab 进容器了，不要抢回来
      const current = document.activeElement
      if (current && container.contains(current) && current !== container) return
      initial.focus({ preventScroll: true })
    }
    if (document.activeElement !== initial) {
      focusRetry = window.setTimeout(() => {
        retryInitialFocus()
        if (document.activeElement !== initial && epochRef.current === epoch) {
          focusRetry2 = window.setTimeout(retryInitialFocus, 0)
        }
      }, 0)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // 抽屉里打开弹层时，Tab / Esc 归弹层处理
      if (pauseWhileDialogOpen && document.querySelector('[role="dialog"]')) return

      if (event.key === 'Escape') {
        if (!escapeRef.current) return
        event.preventDefault()
        event.stopPropagation()
        escapeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = focusableIn(container)
      if (items.length === 0) {
        event.preventDefault()
        container.focus({ preventScroll: true })
        return
      }

      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const activeEl = document.activeElement

      // 焦点若因鼠标点顶栏等原因跑到容器外，Tab 先把它拉回陷阱内
      if (!activeEl || !container.contains(activeEl)) {
        event.preventDefault()
        ;(event.shiftKey ? lastItem : firstItem).focus()
        return
      }

      if (event.shiftKey && (activeEl === firstItem || activeEl === container)) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && activeEl === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      clearTimeout(focusRetry)
      clearTimeout(focusRetry2)
      for (const { el, ariaHidden, inert } of previousA11y) {
        if (ariaHidden === null) el.removeAttribute('aria-hidden')
        else el.setAttribute('aria-hidden', ariaHidden)
        el.inert = inert
      }

      /**
       * 焦点归还推迟到下一个任务。
       *
       * React 在 mutation 阶段会做一次「恢复提交前的焦点」（它自己的
       * restoreSelection），这一步晚于 layout effect 的清理函数；如果这里
       * 同步 focus()，会被 React 立刻覆盖回抽屉里那个导航项。等这一轮提交
       * 结束之后，再判断焦点该给谁：
       * - 抽屉：焦点还在抽屉里 / 掉到 body → 还给打开它的按钮；
       * - 选中平台后调用方会把焦点移到页面标题 → 已在容器外，别抢。
       * 用 setTimeout 而不是 rAF，理由同首次聚焦：后台标签页里 rAF 会停。
       */
      const doRestore = () => {
        // 这里刻意读执行时的最新代次：如果抽屉在这期间又打开了，不能把焦点抢回去
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (epochRef.current !== epoch) return
        // 关闭后已经打开了另一个弹层：焦点归它管，别再抢回来
        if (document.querySelector('[role="dialog"]')) return
        const activeEl = document.activeElement
        const focusStillInside = !activeEl || activeEl === document.body || container.contains(activeEl)
        if (restoreFocus === 'when-inside' && !focusStillInside) return

        // 菜单项触发弹层时，关闭后 <details> 也收起了，原按钮已不可见；
        // 这时把焦点还给菜单触发器，不要让它掉到页面根节点。
        const explicitReturn = previous?.dataset.returnFocus
          ? document.querySelector<HTMLElement>(previous.dataset.returnFocus)
          : null
        const hiddenMenuTrigger =
          previous?.offsetParent === null
            ? previous.closest('details')?.querySelector<HTMLElement>('summary')
            : null
        const fallback = previous?.isConnected ? previous : null
        const target = returnTarget ?? explicitReturn ?? hiddenMenuTrigger ?? fallback
        // 目标可能已经不可见（例如窗口从窄屏拉宽后工具栏按钮被隐藏）
        if (target && target.offsetParent !== null) target.focus({ preventScroll: true })
      }
      window.setTimeout(doRestore, 0)
    }
    // 回调走 ref，不参与依赖；容器与配置都是稳定值，active 变化时重建即可
  }, [active, backgroundSelector, containerRef, restoreFocus, pauseWhileDialogOpen, initialFocus, returnFocusRef])
}
