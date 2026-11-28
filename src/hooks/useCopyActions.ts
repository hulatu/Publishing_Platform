/**
 * 复制 / 下载 / 打包
 *
 * 这段代码里最值钱的东西不是「怎么写剪贴板」，而是**顺序**：
 *
 *   先同步复制 → 再打开标签页
 *
 * 反过来的代价是用户看不到的：新标签会把本页焦点抢走，`navigator.clipboard.writeText`
 * 于是抛 `NotAllowedError: Document is not focused`，`execCommand` 也返回 false，
 * 三个通道一起废掉。用户看到的是「复制失败」，而剪贴板里留着上一次的内容 ——
 * 粘出来就是「复制不全、后半篇丢了」，这个 bug 极难归因。
 *
 * 所以这几个动作被绑成一个 hook：约束和调用点放在一起，后来的人改不动其中的一半。
 * 同理，异步兜底那条路径里也不能先开标签（见 doCopyPrimary 的注释）。
 */

import { useCallback, useRef, useState } from 'react'
import type { Doc } from '../core/ir'
import { copyByMode, copyPlain, copySync, downloadText, mimeFor } from '../core/copy'
import { preopenTab, publishUrlOf } from '../core/publish'
import { splitByH2 } from '../core/split'
import type { TailConfig } from '../core/tail'
import { markCopied as markCopiedRecord, type ArticleLedger, type LedgerWrite } from '../core/ledger'
import { isRewriteId, rewriteIds, type PlatformAIStates } from '../ai/types'
import { REWRITE_FILE_NAMES, rewriteMarkdown } from '../core/rewrite-markdown'
import { convertPlatforms, loadConvertRenderer, type RenderOutput } from '../renderers'
import { downloadBlob, safeFileName } from '../cards/export'

/**
 * 复制失败时的提示文案。
 *
 * 「剪贴板没被改写」这句必须说清：写失败时剪贴板里留的是**上一次**的内容，
 * 用户直接粘出来会以为「复制不全、后半篇丢了」，其实是拿到了旧快照。
 */
const COPY_FAILED = '复制失败：剪贴板没被改写，里面还是上一次的内容'

type Notify = (text: string, kind?: 'info' | 'success' | 'error') => void

interface Options {
  doc: Doc | null
  /** 当前平台的产物；null 表示还没渲染出来 */
  output: RenderOutput | null
  /** 台账 key，空串表示还没导入文章 */
  articleKey: string
  platform: string
  ledger: ArticleLedger
  applyLedger: (w: LedgerWrite) => boolean
  /** 复制后是否自动打开发布页（用户偏好，存在 localStorage） */
  openOnCopy: boolean
  /** 导出全平台时跳过被隐藏的平台 */
  hidden: Set<string>
  themeId: string
  tail: TailConfig
  account: string
  /** 已生成的 AI 文案；导出全平台时一起打包 */
  platformStates: PlatformAIStates
  toast: Notify
}

export interface CopyActions {
  /** 「导出全平台」打包中 */
  zipping: boolean
  /** 复制文本并记一笔台账（改写平台的文案走这条） */
  copyPlainText: (text: string, label: string) => Promise<void>
  /** 只复制、不记台账（标题、标签用这条） */
  copyTextOnly: (text: string, label: string) => Promise<void>
  doCopyPrimary: () => void
  doCopySource: () => void
  doDownload: () => void
  doExportAllPlatforms: () => Promise<void>
  doSplitExport: () => Promise<void>
}

export function useCopyActions({
  doc, output, articleKey, platform, ledger, applyLedger,
  openOnCopy, hidden, themeId, tail, account, platformStates, toast,
}: Options): CopyActions {
  const [zipping, setZipping] = useState(false)
  /**
   * 每个平台上一次自动打开的时间，用来挡住连点两下复制时开出两个标签。
   * 按平台记而不是全局记：在小红书复制完立刻切到微博再复制，
   * 微博那次不该被前一家的 3 秒挡住（那会让人以为「自动打开坏了」）。
   */
  const lastOpenAt = useRef(new Map<string, number>())

  /**
   * 写一段纯文本进剪贴板。
   *
   * 先走同步通道：execCommand 在用户手势里一次就落地，不 await、不受焦点影响。
   * 只有同步通道不可用时才退到异步的 clipboard API。
   */
  const writePlain = useCallback(async (text: string): Promise<boolean> => {
    if (copySync('plain', { text })) return true
    try {
      await copyPlain(text)
      return true
    } catch {
      return false
    }
  }, [])

  const copyPlainText = useCallback(
    async (text: string, label: string) => {
      if (!(await writePlain(text))) {
        toast(COPY_FAILED, 'error')
        return
      }
      // 复制只说明产物准备好了，真正发布由用户在台账里确认
      let tail = ''
      if (articleKey && isRewriteId(platform)) {
        const persisted = applyLedger(markCopiedRecord(articleKey, platform))
        if (persisted && !ledger[platform]?.at && !ledger[platform]?.copiedAt) {
          tail = ' · 已记为待发布'
        }
      }
      toast(`已复制${label}${tail}`, 'success')
    },
    [toast, articleKey, platform, ledger, applyLedger, writePlain],
  )

  /**
   * 只复制、不记台账。
   * 标题和标签是从「标题/标签」弹层里复制的，跟当前停在哪个平台无关 ——
   * 在小红书标签页里复制一个标题，不该被记成「小红书已发布」。
   */
  const copyTextOnly = useCallback(
    async (text: string, label: string) => {
      if (!(await writePlain(text))) {
        toast(COPY_FAILED, 'error')
        return
      }
      toast(`已复制${label}`, 'success')
    },
    [toast, writePlain],
  )

  /**
   * 复制成功后打开发布页。
   *
   * 必须在用户手势里同步开标签（见 core/publish.ts 的 preopenTab）：
   * 等复制这个 await 回来再 window.open 会被弹窗拦截。
   *
   * 连点两下复制时不再开第二个 —— 3 秒内同一个平台只开一次。
   */
  const openPublishFor = useCallback(
    (platformId: string): ReturnType<typeof preopenTab> => {
      if (!openOnCopy) return null
      const target = publishUrlOf(platformId)
      if (!target) return null
      const now = Date.now()
      if (now - (lastOpenAt.current.get(platformId) ?? 0) < 3000) return null
      lastOpenAt.current.set(platformId, now)
      return preopenTab(target.url)
    },
    [openOnCopy],
  )

  /**
   * 复制当前平台的产物。
   *
   * 顺序是这段代码的全部要点：**先同步复制，再开标签**（理由见文件头）。
   */
  const doCopyPrimary = useCallback(() => {
    if (!output) return

    const payload = { html: output.html, text: output.text }
    const finish = (channel: 'rich' | 'plain', openedTab: boolean) => {
      const persisted = articleKey ? applyLedger(markCopiedRecord(articleKey, platform)) : false
      const tail =
        persisted && !ledger[platform]?.at && !ledger[platform]?.copiedAt
          ? ' · 已记为待发布'
          : ''
      // 真的开了标签才说 —— 被设置关掉或被弹窗拦截时不能骗用户
      const opened = openedTab ? ' · 已打开发布页' : ''
      if (output.copyMode === 'rich') {
        toast(
          channel === 'rich'
            ? `已复制富文本，直接粘进编辑器即可${tail}${opened}`
            : `浏览器不支持富文本复制，已改为复制纯文本${tail}${opened}`,
          channel === 'rich' ? 'success' : 'info',
        )
      } else {
        toast(`已复制${tail}${opened}`, 'success')
      }
    }

    // 1) 同步通道：还在用户手势里、本页也还有焦点，一次写完
    const channel = copySync(output.copyMode, payload)
    if (channel) {
      // 2) 复制已经落地，这时候再开标签，焦点被抢走也无所谓了
      const tab = openPublishFor(platform)
      tab?.commit()
      finish(channel, Boolean(tab))
      return
    }

    // 3) 同步通道不可用（极老浏览器 / execCommand 被禁用）才走异步。
    //    这里同样不能先开标签，否则异步复制也会因为失焦而失败。
    //    代价是此时 window.open 已经不在用户激活窗口里了，可能被当成弹窗拦掉 ——
    //    拦了就只复制、不开页面，用户点旁边的「打开发布页」按钮一样能到。
    void (async () => {
      try {
        const mode = await copyByMode(output.copyMode, payload)
        const tab = openPublishFor(platform)
        tab?.commit()
        finish(mode, Boolean(tab))
      } catch {
        toast(COPY_FAILED, 'error')
      }
    })()
  }, [output, toast, articleKey, platform, ledger, applyLedger, openPublishFor])

  const doCopySource = useCallback(() => {
    if (!output) return
    const finish = () => {
      const persisted = articleKey ? applyLedger(markCopiedRecord(articleKey, platform)) : false
      const tail =
        persisted && !ledger[platform]?.at && !ledger[platform]?.copiedAt
          ? ' · 已记为待发布'
          : ''
      toast(`已复制源码${tail}`, 'success')
    }
    if (copySync('plain', { text: output.primary })) {
      finish()
      return
    }
    void (async () => {
      try {
        await copyPlain(output.primary)
        finish()
      } catch {
        toast(COPY_FAILED, 'error')
      }
    })()
  }, [output, toast, articleKey, platform, ledger, applyLedger])

  const doDownload = useCallback(() => {
    if (!output) return
    downloadText(output.primary, output.fileName ?? 'article.md', mimeFor(output.format))
  }, [output])

  /**
   * 把这篇文章在全部「转换」平台上的产物打成一个 zip。
   *
   * 逐个点「下载」会被浏览器拦（多个文件要授权一次），也麻烦。这里一次渲染
   * 7 个平台，文件名带序号，解压后按名称排序就是侧栏的顺序。
   *
   * 转换平台之外，**已经生成**的 AI 文案也一起放进 `ai/`（不重新调模型，
   * 未生成 / 生成中的平台跳过）；配图是 PNG，走各自的导出入口。
   * 隐藏的平台不导 —— 隐藏本来就表示「我不发这家」。 */
  const doExportAllPlatforms = useCallback(async () => {
    if (!doc) return
    const list = convertPlatforms.filter((p) => !hidden.has(p.id))
    if (list.length === 0) {
      toast('没有可导出的平台', 'error')
      return
    }
    setZipping(true)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const slug = safeFileName(doc.meta.slug || doc.meta.title || 'article')

      for (const [i, p] of list.entries()) {
        const render = await loadConvertRenderer(p.id)
        const out = render(doc, { wechatThemeId: themeId, tail, account })
        const ext = out.format === 'markdown' ? 'md' : 'html'
        // 平台名放在文件名里，解压后一眼知道哪个文件给哪家
        zip.file(`${String(i + 1).padStart(2, '0')}-${safeFileName(p.name)}-${slug}.${ext}`, out.primary)
      }

      let aiCount = 0
      for (const id of rewriteIds) {
        if (hidden.has(id)) continue
        const state = platformStates[id]
        if (state.status !== 'done' || !state.result) continue
        const md = rewriteMarkdown(id, state.result)
        if (!md) continue
        zip.file(`ai/${REWRITE_FILE_NAMES[id]}-${slug}.md`, md)
        aiCount++
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(blob, `${slug}-全平台.zip`)
      toast(
        `已导出 ${list.length} 个转换平台${aiCount > 0 ? ` + ${aiCount} 个 AI 文案` : ''}`,
        'success',
      )
    } catch (e) {
      toast(`打包失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setZipping(false)
    }
  }, [doc, hidden, themeId, tail, account, platformStates, toast])

  const doSplitExport = useCallback(async () => {
    if (!doc) return
    const parts = splitByH2(doc)
    const render = await loadConvertRenderer('wechat').catch(() => null)
    if (!render) {
      toast('渲染器加载失败，刷新页面可重试', 'error')
      return
    }
    parts.forEach((part, i) => {
      const out = render(part, { wechatThemeId: themeId, tail, account })
      setTimeout(() => {
        downloadText(
          out.primary,
          `${out.fileName?.replace(/\.html$/, '') ?? `part-${i + 1}`}.html`,
          'text/html',
        )
      }, i * 300)
    })
    toast(`已拆成 ${parts.length} 篇并开始下载`, 'success')
  }, [doc, themeId, tail, account, toast])

  return {
    zipping,
    copyPlainText,
    copyTextOnly,
    doCopyPrimary,
    doCopySource,
    doDownload,
    doExportAllPlatforms,
    doSplitExport,
  }
}
