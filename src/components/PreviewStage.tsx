/**
 * 预览画布：自适应 / 手机 / 平板三种宽度。
 *
 * 为什么不用 `max-width` 直接把纸压窄：
 * 手机预览的价值是「在 390px 下真的长这样」，纸被容器压到 320px 时，
 * 换行位置、标题折行、表格挤压全都不是目标宽度下的结果。
 * 所以固定宽度按比例缩放，纸本身仍然按 390 / 820 排版。
 *
 * 缩放用的是 MDskill-Web 的同一套思路（ResizeObserver + transform），
 * 但测量对象是外层全宽容器而不是纸本身 —— 如果量纸，纸一缩小，
 * 下次量到的可用宽度也跟着缩小，会越缩越小。
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type PreviewSize = 'auto' | 'mobile' | 'tablet'

const PAPER_WIDTH: Record<Exclude<PreviewSize, 'auto'>, number> = {
  mobile: 390,
  tablet: 820,
}

interface Props {
  size: PreviewSize
  children: ReactNode
  /** 纸面上方的两行说明，左边固定文案、右边当前宽度 */
  caption?: { left: string; right: string }
  /** 纸面下方的收束文案 */
  footnote?: string
}

export function PreviewStage({ size, children, caption, footnote }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(0)
  const [paperHeight, setPaperHeight] = useState(0)

  useLayoutEffect(() => {
    if (size === 'auto') return
    const stage = stageRef.current
    const paper = paperRef.current
    if (!stage || !paper) return

    const measure = (width: number, height?: number) => {
      if (width > 0) setAvailable(width)
      if (height !== undefined && height > 0) setPaperHeight(height)
    }

    measure(stage.getBoundingClientRect().width, paper.offsetHeight)

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === stage) {
          measure(entry.contentRect.width)
        } else if (entry.target === paper) {
          measure(0, entry.borderBoxSize[0]?.blockSize ?? paper.offsetHeight)
        }
      }
    })
    observer.observe(stage)
    observer.observe(paper)
    return () => observer.disconnect()
  }, [size])

  if (size === 'auto') {
    return (
      <div className="stage preview-stage">
        {caption ? (
          <div className="preview-caption" style={{ maxWidth: 'var(--read-w)' }}>
            <span>{caption.left}</span>
            <span>{caption.right}</span>
          </div>
        ) : null}
        {children}
        {footnote ? <p className="preview-footnote">{footnote}</p> : null}
      </div>
    )
  }

  const paperWidth = PAPER_WIDTH[size]
  const scale = available > 0 ? Math.min(1, available / paperWidth) : 1
  const fitWidth = paperWidth * scale

  return (
    <div
      className="stage preview-stage"
      ref={stageRef}
      data-preview-size={size}
      data-preview-scaled={scale < 0.999 ? 'true' : undefined}
    >
      {caption ? (
        <div className="preview-caption" style={{ width: fitWidth }}>
          <span>{caption.left}</span>
          <span>{caption.right}</span>
        </div>
      ) : null}
      <div
        className="preview-fit"
        style={{ width: fitWidth, height: paperHeight > 0 ? paperHeight * scale : undefined }}
      >
        <div
          className="preview-paper"
          ref={paperRef}
          style={{ width: paperWidth, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
      {footnote ? (
        <p className="preview-footnote" style={{ width: fitWidth }}>
          {footnote}
        </p>
      ) : null}
    </div>
  )
}
