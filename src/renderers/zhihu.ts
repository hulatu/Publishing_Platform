/**
 * 知乎
 *
 * 知乎有两条可靠路径，产物两份都给：
 * 1. **富文本**（主，默认复制）—— 直接粘贴 HTML。知乎会保留语义级样式
 *    （加粗/斜体/引用/表格/链接），字号与行距归它自己管；代码块会退化成纯文本。
 *    图片带 `figure + figcaption` 时才进知乎原生的「图片注释」。
 * 2. **Markdown**（备，下载 .md 后走专栏导入）—— 代码块能进「代码卡片」，
 *    标题层级与表格保真；图片同样写成 figure，导入后图注进「图片注释」。
 *
 * 默认改成富文本，是因为「复制 → 粘贴」是最短路径，图注能直接落在图片上；
 * 正文含代码时界面上会提示改用 .md 导入。
 */

import type { Doc } from '../core/ir'
import { collectImages, collectLinks } from '../core/ir'
import { toMarkdown } from '../core/markdown-out'
import { renderHtml } from '../core/html-inline'
import { charCount } from '../core/cjk'
import { doubanTheme } from '../themes/wechat'
import type { ConvertOptions, RenderOutput } from './index'

export function renderZhihu(doc: Doc, _opts: ConvertOptions): RenderOutput {
  // figureImages：知乎的 .md 导入不认 `![alt]()` 的 alt，导入后图片注释是空的；
  // 写成 <figure><img><figcaption> 才会进知乎原生的「图片注释」。
  const md = toMarkdown(doc.blocks, undefined, { figureImages: true })
  // 剪贴板的纯文本兜底不用 figure —— 万一编辑器退到 text/plain，裸标签会露出来。
  // 兜底走「图 + 斜体图注」，和少数派同一种安全写法。
  const plainMd = toMarkdown(doc.blocks, undefined, { captionLines: true })
  const images = collectImages(doc.blocks)
  const links = collectLinks(doc.blocks)
  const warnings: string[] = []

  // 富文本版本：目标为 web（用 h2/pre/hr），链接保留 <a>
  const rich = renderHtml(doc.blocks, {
    theme: doubanTheme,
    linkMode: 'inline',
    target: 'web',
    figureImages: true,
  })

  // 富文本默认复制：图注要进「图片注释」，只认 figure + figcaption。
  // 实测知乎粘贴时优先用 text/html（纯文本只作兜底），所以两种形态都写。
  warnings.push(
    '已按富文本准备：图片说明会进知乎「图片注释」；正文含代码时请改用「下载 .md」导入，富文本会丢代码块结构',
  )

  const hasCode = doc.blocks.some((b) => b.t === 'code')
  if (hasCode) {
    warnings.push('正文含代码块：只有「下载 .md」导入路径能保留为知乎「代码卡片」')
  }

  return {
    primary: md.body,
    html: rich.html,
    text: plainMd.body,
    format: 'markdown',
    copyMode: 'rich',
    warnings,
    stats: [
      { label: '正文', value: `${charCount(md.body)} 字符` },
      { label: '富文本', value: `${rich.charCount} 字符` },
      { label: '图片', value: `${images.length} 张` },
      { label: '外链', value: `${links.length} 个` },
    ],
    fileName: `${doc.meta.slug || 'article'}.md`,
  }
}
