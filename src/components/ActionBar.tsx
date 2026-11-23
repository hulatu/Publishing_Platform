/**
 * 操作条
 *
 * 主区域底部那条：复制 / 打开发布页 / 生成 / 更多。原来它是 App.tsx 里 220 行
 * 交织在一起的 JSX —— convert、rewrite、card 三种平台的条件层层嵌套，
 * 读的时候得同时记住三层。拆开之后每个分支只关心自己那一种平台。
 *
 * 状态判断仍然留在 App：这个组件只负责「长什么样、点了调谁」。
 */

import type { MouseEvent, ReactNode, RefObject } from 'react'
import type { Doc } from '../core/ir'
import type { RenderOutput } from '../renderers'
import { shortcutLabel } from '../core/keys'

export type ActionKind = 'convert' | 'rewrite' | 'card'

/** 各平台的发布页；没有（比如配图卡片）就是 null */
export interface PublishTarget {
  url: string
  note?: string
}

interface Props {
  kind: ActionKind
  doc: Doc
  output: RenderOutput | null
  /** 当前平台的显示名，用于按钮文案「生成{小红书}文案」 */
  platformName: string
  publishTarget: PublishTarget | null
  /** 已复制但还没确认发布 / 已确认发布 */
  currentPrepared: boolean
  currentPublished: boolean
  /** 当前平台已经有产物（convert 的是 output，rewrite 的是文案） */
  currentGenerated: boolean
  allPublished: boolean
  platformTotal: number
  nextUnpublished: { id: string; name: string } | null

  /** 摘要或文案正在生成 */
  busy: boolean
  /** 当前平台的文案正在生成（决定「重新生成」按钮转不转） */
  aiRunning: boolean
  /** 当前平台有写好的文案（决定「重新生成」出不出现） */
  hasRewriteResult: boolean
  /** 当前平台的文案能直接复制（有结果、也拼得出对应平台的那份） */
  canCopyRewrite: boolean
  /** 「完整 thread」这类标签，用在按钮 title 上 */
  rewriteCopyLabel: string | null

  zipping: boolean
  openOnCopy: boolean
  onToggleOpenOnCopy: (on: boolean) => void

  onCopyPrimary: () => void
  onCopySource: () => void
  onDownload: () => void
  onExportAll: () => void
  /** 按 H2 把当前文章拆成多篇导出（不再和字数上限绑定） */
  onSplitExport: () => void
  onGenerateAll: () => void
  onCopyCurrent: () => void
  onGenerateCurrent: () => void
  onMarkPublished: () => void
  onSelectPlatform: (id: string) => void

  /** App 用它量高度，写进 --actionbar-h 给 toast 定位 */
  actionbarRef: RefObject<HTMLDivElement | null>
}

export function ActionBar(props: Props) {
  const { kind, output, currentPrepared, currentPublished, allPublished, platformTotal } = props
  const next = props.nextUnpublished

  return (
    <div className="actionbar" ref={props.actionbarRef}>
      {kind === 'convert' && output ? <ConvertActions {...props} output={output} /> : null}
      {kind === 'rewrite' ? <RewriteActions {...props} /> : null}

      {currentPublished && next ? (
        <button className="btn" onClick={() => props.onSelectPlatform(next.id)}>
          下一个：{next.name}
        </button>
      ) : null}

      {allPublished ? (
        <span className="actionbar-complete">
          <span aria-hidden>✓</span>
          {platformTotal} 个平台已全部发布
        </span>
      ) : null}

      {kind === 'card' ? (
        <span className="muted actionbar-note">左侧选卡片、改文字、换配色，然后导出 PNG</span>
      ) : null}

      <div className="actionbar-spacer" />

      {kind !== 'card' ? (
        <div className="actionbar-tools">
          {props.publishTarget && props.currentGenerated && !(currentPrepared && !currentPublished) ? (
            <a
              className="btn btn-sm btn-quiet publish-now"
              href={props.publishTarget.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`在浏览器打开${props.platformName || '该平台'}的发布页${
                props.publishTarget.note ? `（${props.publishTarget.note}）` : ''
              }`}
            >
              打开发布页
              <span className="publish-now-arrow" aria-hidden>
                ↗
              </span>
            </a>
          ) : null}

          <ToolsMenu {...props} />
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */

/** 「打开发布页」这个链接在操作条里出现三次，文案只有标题不同 */
function PublishLink({
  target,
  title,
  className = 'btn btn-accent',
  children,
}: {
  target: PublishTarget
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <a className={className} href={target.url} target="_blank" rel="noopener noreferrer" title={title}>
      {children}
      <span aria-hidden>↗</span>
    </a>
  )
}

function ConvertActions({
  output,
  publishTarget,
  platformName,
  currentPrepared,
  currentPublished,
  onCopyPrimary,
  onMarkPublished,
}: Props & { output: RenderOutput }) {
  return (
    <>
      {currentPrepared && !currentPublished && publishTarget ? (
        <PublishLink
          target={publishTarget}
          title={`已复制。在浏览器打开${platformName || '该平台'}发布页`}
        >
          打开发布页
        </PublishLink>
      ) : (
        <button
          className="btn btn-accent"
          onClick={onCopyPrimary}
          title={`复制当前平台产物（${shortcutLabel('Enter')}）`}
        >
          {output.copyMode === 'rich'
            ? '复制富文本'
            : output.copyMode === 'markdown'
              ? '复制 Markdown'
              : '复制全文'}
        </button>
      )}
      {currentPrepared && !currentPublished ? (
        <>
          <button className="btn" onClick={onCopyPrimary}>
            再次复制
          </button>
          <button className="btn btn-quiet" onClick={onMarkPublished}>
            标记已发布
          </button>
        </>
      ) : null}
    </>
  )
}

function RewriteActions({
  publishTarget,
  platformName,
  currentPrepared,
  currentPublished,
  busy,
  aiRunning,
  hasRewriteResult,
  canCopyRewrite,
  rewriteCopyLabel,
  onCopyCurrent,
  onGenerateCurrent,
  onMarkPublished,
}: Props) {
  return (
    <>
      {currentPrepared && !currentPublished && publishTarget ? (
        <PublishLink
          target={publishTarget}
          title={`文案已复制。打开${platformName || '该平台'}发布页`}
        >
          打开发布页
        </PublishLink>
      ) : canCopyRewrite ? (
        <button
          className="btn btn-accent"
          onClick={onCopyCurrent}
          title={`复制${rewriteCopyLabel ?? ''}（${shortcutLabel('Enter')}）`}
        >
          复制{platformName}文案
        </button>
      ) : (
        <button className="btn btn-accent" onClick={onGenerateCurrent} disabled={busy}>
          {busy ? <span className="spinner" /> : null}
          {busy ? '生成中…' : `生成${platformName}文案`}
        </button>
      )}

      {hasRewriteResult ? (
        <button className="btn" onClick={onGenerateCurrent} disabled={busy}>
          {aiRunning ? <span className="spinner" /> : null}
          {aiRunning ? '生成中…' : '重新生成'}
        </button>
      ) : null}

      {currentPrepared && !currentPublished ? (
        <button className="btn btn-quiet" onClick={onMarkPublished}>
          标记已发布
        </button>
      ) : null}
    </>
  )
}

function ToolsMenu({
  kind,
  output,
  busy,
  zipping,
  openOnCopy,
  onToggleOpenOnCopy,
  onCopySource,
  onDownload,
  onExportAll,
  onSplitExport,
  onGenerateAll,
}: Props) {
  /** 菜单项点完就收起：<details> 不会自己关 */
  const closeMenu = (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
  }

  return (
    <details
      className="action-more"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          event.currentTarget.removeAttribute('open')
        }
      }}
    >
      <summary className="btn btn-sm">
        {zipping ? <span className="spinner" /> : null}
        {zipping ? '打包中…' : '更多'}
      </summary>
      <div className="action-more-menu">
        {kind === 'convert' && output ? (
          <>
            {output.format !== 'markdown' ? (
              <button
                aria-label="复制 HTML 源码"
                onClick={(event) => {
                  closeMenu(event)
                  onCopySource()
                }}
              >
                <span>复制 HTML 源码</span>
              </button>
            ) : null}
            <button
              aria-label={`下载 ${output.format === 'markdown' ? 'Markdown' : 'HTML'} 文件`}
              onClick={(event) => {
                closeMenu(event)
                onDownload()
              }}
            >
              <span>下载 {output.format === 'markdown' ? '.md' : '.html'}</span>
            </button>
            <button
              aria-label="导出全平台"
              disabled={zipping}
              onClick={(event) => {
                closeMenu(event)
                onExportAll()
              }}
            >
              <span>{zipping ? '正在打包…' : '导出全平台'}</span>
            </button>
            <button
              aria-label="按二级标题拆成多篇导出"
              onClick={(event) => {
                closeMenu(event)
                onSplitExport()
              }}
            >
              <span>按 H2 拆成多篇</span>
            </button>
            <div className="action-more-sep" />
          </>
        ) : null}

        {kind === 'rewrite' ? (
          <button
            disabled={busy}
            onClick={(event) => {
              closeMenu(event)
              onGenerateAll()
            }}
          >
            <span>四个平台一起生成</span>
          </button>
        ) : null}

        <label className="action-more-check">
          <input
            type="checkbox"
            aria-label="复制后自动打开发布页"
            checked={openOnCopy}
            onChange={(event) => onToggleOpenOnCopy(event.target.checked)}
          />
          <span>复制后自动打开发布页</span>
        </label>
      </div>
    </details>
  )
}
