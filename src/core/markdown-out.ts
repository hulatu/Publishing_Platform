/**
 * IR → 规范化 Markdown
 *
 * 用于：少数派导入、知乎专栏 .md 导入、「复制 Markdown」出口、以及作为信息兜底。
 * 目标不是「还原原文」，而是「产出一份任何 Markdown 解析器都能正确渲染的干净文本」。
 */

import type { Block, Inline } from './ir'

/** 转义 Markdown 里会被误解析的字符 */
function esc(s: string): string {
  return s.replace(/([\\`*_[\]])/g, '\\$1')
}

/** 表格单元格内额外转义竖线 */
function escCell(s: string): string {
  return esc(s).replace(/\|/g, '\\|')
}

/**
 * 行首的块级标记要转义，否则这段文字会被下一次解析当成标题 / 列表 / 引用。
 *
 * 真实踩坑：一篇讲 Markdown 语法的文章，列表项内容就是「# + 空格 + 内容」，
 * 导出成 Markdown 后那一项变成了一个二级标题，「可以表示几级标题」这句话
 * 直接换了语义。`esc()` 只处理行内字符（`* _ [ ]` 反引号），管不到行首。
 *
 * 有序列表的转义点要落在 `.` / `)` 上（`1\.`）—— 反斜杠加数字在 CommonMark 里
 * 不算转义，`\1` 会原样输出成 `\1`。
 */
function guardLineStart(md: string): string {
  return md
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)([#>+-])(?=\s|$)/, '$1\\$2')
        .replace(/^(\s*)(\d+)([.)])(?=\s)/, '$1$2\\$3'),
    )
    .join('\n')
}

export function inlineToMd(nodes: Inline[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out += esc(n.v)
        break
      case 'strong':
        out += `**${inlineToMd(n.c)}**`
        break
      case 'em':
        out += `*${inlineToMd(n.c)}*`
        break
      case 'del':
        out += `~~${inlineToMd(n.c)}~~`
        break
      case 'code':
        // 内容里含反引号时用双反引号包裹
        out += n.v.includes('`') ? `\`\` ${n.v} \`\`` : `\`${n.v}\``
        break
      case 'link':
        out += `[${inlineToMd(n.c)}](${n.href})`
        break
      case 'img':
        out += `![${n.alt || ''}](${n.src}${n.title ? ` "${n.title}"` : ''})`
        break
      case 'br':
        out += '  \n'
        break
      case 'fnref':
        // 用 label 而不是 id：定义那边写的是 `[^1]:`，这里必须是 `[^1]` 才对得上
        out += `[^${n.label ?? n.id}]`
        break
      case 'html':
        out += n.raw
        break
    }
  }
  return out
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? prefix + line : line))
    .join('\n')
}

export function blocksToMd(blocks: Block[], depth = 0): string {
  const parts: string[] = []

  for (const b of blocks) {
    switch (b.t) {
      case 'heading': {
        parts.push(`${'#'.repeat(b.level)} ${inlineToMd(b.inline)}`)
        break
      }
      case 'p': {
        parts.push(guardLineStart(inlineToMd(b.inline)))
        break
      }
      case 'quote': {
        const inner = blocksToMd(b.children, depth)
        parts.push(
          inner
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n'),
        )
        break
      }
      case 'list': {
        const lines: string[] = []
        b.items.forEach((item, idx) => {
          const marker = b.ordered ? `${(b.start ?? 1) + idx}. ` : '- '
          const itemMd = blocksToMd(item, depth + 1)
          const itemLines = itemMd.split('\n')
          // 首行接在 marker 后，其余行缩进对齐
          const pad = ' '.repeat(marker.length)
          lines.push(
            itemLines
              .map((line, li) => (li === 0 ? marker + line : line ? pad + line : line))
              .join('\n'),
          )
        })
        parts.push(lines.join('\n'))
        break
      }
      case 'code': {
        const fence = b.text.includes('```') ? '````' : '```'
        parts.push(`${fence}${b.lang ?? ''}\n${b.text}\n${fence}`)
        break
      }
      case 'img': {
        parts.push(`![${b.alt || ''}](${b.src}${b.title ? ` "${b.title}"` : ''})`)
        break
      }
      case 'table': {
        const headCells = b.head.map((c) => escCell(inlineToMd(c)))
        const rows = b.rows.map((row) => row.map((c) => escCell(inlineToMd(c))))
        const cols = Math.max(headCells.length, ...rows.map((r) => r.length), 1)
        const pad = (cells: string[]) => {
          const filled = [...cells]
          while (filled.length < cols) filled.push('')
          return `| ${filled.join(' | ')} |`
        }
        const sep = `| ${Array.from({ length: cols }, (_, i) => {
          const a = b.align[i]
          return a === 'l' ? ':---' : a === 'c' ? ':---:' : a === 'r' ? '---:' : '---'
        }).join(' | ')} |`
        parts.push([pad(headCells), sep, ...rows.map(pad)].join('\n'))
        break
      }
      case 'fn': {
        const inner = blocksToMd(b.children, depth)
        const label = b.label ?? b.id
        parts.push(`[^${label}]: ${inner.replace(/\n/g, ' ')}`)
        break
      }
      case 'hr': {
        parts.push('---')
        break
      }
      case 'html': {
        parts.push(b.raw.trim())
        break
      }
    }
  }

  return parts.join('\n\n')
}

export interface MarkdownOutput {
  markdown: string
  /** 正文 Markdown（不含 front matter） */
  body: string
  /** 带 front matter 的完整文件内容，便于直接存成 .md */
  withFrontMatter: string
}

/** 生成 front matter 头部（YAML，字段顺序稳定） */
export function buildFrontMatter(meta: {
  title: string
  categories: string[]
  tags: string[]
  date?: string
  summary?: string
  description?: string
  slug?: string
}): string {
  const lines: string[] = ['---']
  lines.push(`title: "${meta.title.replace(/"/g, '\\"')}"`)
  if (meta.categories.length) {
    lines.push(`categories: [${meta.categories.map((c) => `"${c}"`).join(', ')}]`)
  }
  if (meta.tags.length) {
    lines.push(`tags: [${meta.tags.map((t) => `"${t}"`).join(', ')}]`)
  }
  if (meta.date) lines.push(`date: ${meta.date}`)
  if (meta.summary) lines.push(`summary: "${meta.summary.replace(/"/g, '\\"')}"`)
  if (meta.slug) lines.push(`slug: "${meta.slug}"`)
  lines.push('---')
  return lines.join('\n')
}

export function toMarkdown(blocks: Block[], meta?: Parameters<typeof buildFrontMatter>[0]): MarkdownOutput {
  const body = blocksToMd(blocks)
  const fm = meta ? buildFrontMatter(meta) : ''
  return {
    markdown: body,
    body,
    withFrontMatter: fm ? `${fm}\n\n${body}\n` : `${body}\n`,
  }
}

export { indent }
