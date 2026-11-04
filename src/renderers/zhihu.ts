/**
 * 知乎
 *
 * 知乎有两条可靠路径，都提供：
 * 1. **Markdown**（主）—— 专栏编辑器支持 .md 导入，代码块能进「代码卡片」，
 *    标题层级与表格保真。这是最保真的方式。
 * 2. **富文本**（备）—— 直接粘贴 HTML。知乎只保留「语义级」样式
 *    （加粗/斜体/引用/表格/链接），字号与行距会被归一化，代码块会退化成纯文本。
 *
 * 之所以主推 Markdown：知乎的富文本粘贴会丢掉代码块结构，而博文里有代码。
 */

import type { Doc } from '../core/ir'
import { collectImages, collectLinks } from '../core/ir'
import { toMarkdown } from '../core/markdown-out'
import { renderHtml } from '../core/html-inline'
import { charCount } from '../core/cjk'
import { doubanTheme } from '../themes/wechat'
import type { ConvertOptions, RenderOutput } from './index'

export function renderZhihu(doc: Doc, _opts: ConvertOptions): RenderOutput {
  const md = toMarkdown(doc.blocks)
  const images = collectImages(doc.blocks)
  const links = collectLinks(doc.blocks)
  const warnings: string[] = []

  // 富文本版本：目标为 web（用 h2/pre/hr），链接保留 <a>
  const rich = renderHtml(doc.blocks, {
    theme: doubanTheme,
    linkMode: 'inline',
    target: 'web',
  })

  if (images.length > 0) {
    warnings.push(
      `正文有 ${images.length} 张外链图片，知乎会尝试转存；带防盗链的图床可能失败。`,
    )
  }
  warnings.push('推荐「下载 .md」再走知乎专栏导入；富文本粘贴会丢代码块结构')

  const hasCode = doc.blocks.some((b) => b.t === 'code')
  if (hasCode) {
    warnings.push('正文含代码块：只有 Markdown 导入路径能保留为知乎「代码卡片」')
  }

  return {
    primary: md.body,
    html: rich.html,
    text: md.body,
    format: 'markdown',
    copyMode: 'markdown',
    warnings,
    stats: [
      { label: '正文', value: `${charCount(md.body)} 字符` },
      { label: '富文本', value: `${rich.charCount} 字符` },
      { label: '图片', value: `${images.length} 张`, level: images.length > 0 ? 'warn' : 'ok' },
      { label: '外链', value: `${links.length} 个` },
    ],
    fileName: `${doc.meta.slug || 'article'}.md`,
  }
}
