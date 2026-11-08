/**
 * 剪贴板
 *
 * 关键点 1：往公众号 / 知乎粘贴必须走 text/html，否则编辑器拿到的是一串 HTML 源码。
 * 同时附带 text/plain 兜底 —— 有些编辑器在无 HTML 支持时会取纯文本。
 *
 * 关键点 2（踩过的坑，别改回去）：**复制必须在开新标签之前完成**。
 *
 * 点「复制」会顺手打开发布页（preopenTab）。新标签一激活，本页的
 * `document.hasFocus()` 就变成 false，而：
 *   - `navigator.clipboard.write()` / `writeText()` 会抛
 *     `NotAllowedError: Document is not focused`
 *   - `document.execCommand('copy')` 直接返回 false
 * 三个通道一起失效，用户看到的就是「复制失败」，而剪贴板里还留着上一次的内容 ——
 * 于是再粘出来就是「复制不完全、丢了后面新加的部分」。
 *
 * 所以：**先同步 execCommand 把内容写进剪贴板，再去开标签。**
 * 同步通道不 await、不受焦点影响，在用户手势里一次就把活干完；
 * 之后哪怕新标签把焦点抢走，剪贴板里已经是对的了。
 *
 * `ClipboardItem` 那条异步通道仍然保留，但只作为同步通道不可用时的兜底
 * （极老浏览器、或 execCommand 被策略禁用）。
 */

export type CopyMode = 'rich' | 'plain' | 'markdown'

export interface CopyPayload {
  html?: string
  text: string
}

/** 实际写进剪贴板的内容形态 */
export type CopyChannel = 'rich' | 'plain'

/**
 * 离屏容器的样式。
 *
 * 不能用 display:none / visibility:hidden —— 那样元素不参与渲染，
 * 选区建不起来，execCommand('copy') 直接返回 false。
 * 用 opacity:0 + 移出交互层：元素照样渲染，用户看不见也点不到。
 */
const OFFSCREEN = 'position:fixed;top:0;left:0;width:820px;opacity:0;pointer-events:none;z-index:-1;'

/**
 * 同步复制：选区只用来「触发」copy 事件，真正写进剪贴板的数据由 handler 直接给。
 *
 * 为什么不用「把 HTML 塞进 contenteditable 再选中复制」那套：
 * 浏览器复制富文本时会走编辑器的序列化管线，把每个元素的 style **展开成计算值**
 * （box-sizing / orphans / widows / -webkit-text-stroke-width 全给补上）。
 * 实测同一篇稿子 58891 字符会被撑到 80610，头条那套主题更是 57799 → 277680。
 * 而 `clipboardData.setData('text/html', …)` 是原样写入，一个字节都不多。
 */
function copyExact(html: string | undefined, text: string): boolean {
  // 先造一个真选区，保证 execCommand('copy') 一定会派发 copy 事件
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', '')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.cssText = OFFSCREEN
  document.body.appendChild(holder)
  holder.select()
  holder.setSelectionRange(0, text.length)

  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.clipboardData.setData('text/plain', text)
    if (html) e.clipboardData.setData('text/html', html)
    e.preventDefault()
  }

  document.addEventListener('copy', onCopy, true)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.removeEventListener('copy', onCopy, true)
    document.body.removeChild(holder)
  }
  return ok
}

/**
 * 同步复制。**必须在用户手势里同步调用，且不要在调用前 await 任何东西。**
 *
 * 返回实际写进去的形态；返回 null 表示同步通道不可用，调用方再去走异步兜底。
 * 调用方拿到非 null 就应该立刻去开标签 —— 这个顺序是刻意的，见文件头。
 */
export function copySync(mode: CopyMode, payload: CopyPayload): CopyChannel | null {
  const html = mode === 'rich' ? payload.html : undefined
  if (!copyExact(html, payload.text)) return null
  return html ? 'rich' : 'plain'
}

/* ------------------------------------------------------------------ */
/* 异步兜底通道                                                         */
/* ------------------------------------------------------------------ */

function isNotAllowed(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
}

/** 等本页重新拿到焦点（最多 ms 毫秒）；已经聚焦或超时就立刻返回 */
function waitForFocus(ms: number): Promise<void> {
  if (document.hasFocus()) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('focus', done)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, ms)
    window.addEventListener('focus', done)
  })
}

/**
 * 剪贴板 API 在文档失焦时抛 NotAllowedError。
 * 这时候先等一下焦点回来再重试一次 —— 比直接判失败合理得多。
 */
async function retryOnFocus(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (!isNotAllowed(err) || document.hasFocus()) throw err
    await waitForFocus(2000)
    await fn()
  }
}

/** 复制富文本（HTML）到剪贴板，失败时降级为纯文本 */
export async function copyRich(payload: CopyPayload): Promise<CopyChannel> {
  const { html, text } = payload

  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await retryOnFocus(() =>
        navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]),
      )
      return 'rich'
    } catch {
      // 继续尝试纯文本
    }
  }

  await copyPlain(text)
  return 'plain'
}

export async function copyPlain(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await retryOnFocus(() => navigator.clipboard.writeText(text))
      return
    } catch {
      // 文档失焦、iframe 未授权、权限被拒时 writeText 会抛 NotAllowedError。
      // 此时 execCommand 在用户手势里通常还能成 —— 继续往下走，别直接判失败。
    }
  }
  if (!copyExact(undefined, text)) throw new Error('剪贴板不可用')
}

/** 按指定模式复制（异步兜底版；能用 copySync 就先用 copySync） */
export async function copyByMode(mode: CopyMode, payload: CopyPayload): Promise<CopyChannel> {
  if (mode === 'rich' && payload.html) return copyRich(payload)
  await copyPlain(payload.text)
  return 'plain'
}

/** 触发浏览器下载 */
export function downloadText(content: string, fileName: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 立刻 revoke 会让部分浏览器取消下载，延迟回收
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function mimeFor(format: 'markdown' | 'html' | 'text'): string {
  if (format === 'markdown') return 'text/markdown'
  if (format === 'html') return 'text/html'
  return 'text/plain'
}
