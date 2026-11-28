/**
 * 把已生成的 AI 文案导成 Markdown
 *
 * 「导出全平台」原来只包含 7 个确定性转换平台；AI 改写的 4 个平台
 * 花过 token，却不进 zip，只能逐个复制。这里把结果转成可直接归档的 .md，
 * 目录固定为 `ai/`，文件名用短平台名，避免「推特 / X」里的斜杠。
 *
 * 只做纯文本转换：不调用模型、不补标题，没生成过的平台返回 null。
 */

import type { AIResultSet, RewriteId } from '../ai/types'

/** zip 里的短平台名；不要带 `/` 等路径字符 */
export const REWRITE_FILE_NAMES: Record<RewriteId, string> = {
  xiaohongshu: '小红书',
  twitter: '推特-X',
  jike: '即刻',
  weibo: '微博',
}

function lines(parts: string[]): string {
  return parts.map((s) => s.trim()).filter(Boolean).join('\n\n') + '\n'
}

export function rewriteMarkdown(id: RewriteId, result: AIResultSet): string | null {
  switch (id) {
    case 'xiaohongshu': {
      const x = result.xhs
      if (!x) return null
      const tags = x.tags.map((t) => `#${t.trim()}`).filter((t) => t.length > 1).join(' ')
      return lines([`# ${x.title}`, x.body, tags])
    }
    case 'twitter': {
      const t = result.twitter
      if (!t || t.thread.length === 0) return null
      const n = t.thread.length
      return lines([
        '# 推特 / X thread',
        ...t.thread.map((text, i) => `${i + 1}/${n} ${text.trim()}`),
      ])
    }
    case 'jike': {
      const j = result.jike
      if (!j) return null
      return lines(['# 即刻', j.body])
    }
    case 'weibo': {
      const w = result.weibo
      if (!w) return null
      const topics = w.topics.map((t) => `#${t.trim()}#`).filter((t) => t.length > 2).join(' ')
      return lines(['# 微博', [w.text, topics].filter(Boolean).join(' ')])
    }
  }
  return null
}
