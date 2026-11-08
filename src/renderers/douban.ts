/**
 * 豆瓣
 *
 * 豆瓣日记的富文本编辑器支持有限 HTML：p / strong / em / blockquote / img / a /
 * ul / ol / li / h2-h4 / hr。不支持自定义字体、复杂背景与 section 结构。
 * 所以这里走 target='web'（标准 HTML 标签），并保留 <a> 链接。
 *
 * 图片同样走外链，豆瓣会自动转存 —— 可靠性比公众号高得多。
 */

import type { Doc } from '../core/ir'
import { collectImages } from '../core/ir'
import { renderHtml } from '../core/html-inline'
import { charCount } from '../core/cjk'
import { doubanTheme } from '../themes/wechat'
import type { ConvertOptions, RenderOutput } from './index'

export function renderDouban(doc: Doc, _opts: ConvertOptions): RenderOutput {
  const result = renderHtml(doc.blocks, {
    theme: doubanTheme,
    linkMode: 'inline',
    target: 'web',
    fnTitle: '注释',
  })

  const images = collectImages(doc.blocks)
  const warnings: string[] = []

  warnings.push('豆瓣不支持自定义字体与复杂背景，已降级为标准 HTML 标签')

  return {
    primary: result.html,
    html: result.html,
    text: result.text,
    format: 'html',
    copyMode: 'rich',
    warnings: [...warnings, ...result.warnings],
    stats: [
      { label: '正文', value: `${charCount(result.text)} 字` },
      { label: 'HTML', value: `${result.charCount} 字符` },
      { label: '图片', value: `${images.length} 张` },
    ],
    fileName: `${doc.meta.slug || 'article'}.html`,
  }
}
