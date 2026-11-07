/**
 * 剪贴板
 *
 * 关键点：往公众号 / 知乎粘贴必须走 ClipboardItem 的 text/html，
 * 这样编辑器拿到的才是「富文本」而不是一串 HTML 源码。
 * 同时附带 text/plain 兜底 —— 有些编辑器在无 HTML 支持时会取纯文本。
 */

export type CopyMode = 'rich' | 'plain' | 'markdown'

export interface CopyPayload {
  html?: string
  text: string
}

/** 复制富文本（HTML）到剪贴板，失败时降级为纯文本 */
export async function copyRich(payload: CopyPayload): Promise<'rich' | 'plain'> {
  const { html, text } = payload

  if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
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
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // 文档失焦、iframe 未授权、权限被拒时 writeText 会抛 NotAllowedError。
      // 此时 execCommand 在用户手势里通常还能成 —— 继续往下走，别直接判失败。
    }
  }
  // 兜底：老浏览器，或上面被拒绝的情况
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '0'
  ta.style.opacity = '0'
  // iOS 上 readonly + contentEditable 才不会弹键盘
  ta.setAttribute('readonly', '')
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  if (!ok) throw new Error('剪贴板不可用')
}

/** 按指定模式复制 */
export async function copyByMode(mode: CopyMode, payload: CopyPayload): Promise<'rich' | 'plain'> {
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
