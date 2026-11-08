/**
 * 少数派（sspai.com）
 *
 * 少数派编辑器原生支持 Markdown 导入，所以这里只做「规范化」：
 * 把 IR 重新序列化成一份干净、无歧义的 Markdown，任何解析器都能正确渲染。
 *
 * 图片走正文里的外链即可（实测自建图床的图能正常显示），不再单独列「待上传清单」。
 */

import type { Doc } from '../core/ir'
import { collectImages, collectLinks } from '../core/ir'
import { toMarkdown } from '../core/markdown-out'
import { charCount } from '../core/cjk'
import type { ConvertOptions, RenderOutput } from './index'

export function renderSspai(doc: Doc, _opts: ConvertOptions): RenderOutput {
  const md = toMarkdown(doc.blocks)
  const images = collectImages(doc.blocks)
  const links = collectLinks(doc.blocks)
  const warnings: string[] = []

  if (links.length > 0) {
    warnings.push(`正文含 ${links.length} 个外链，导入后抽查几个是否被正确解析`)
  }

  const slug = doc.meta.slug || doc.meta.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

  return {
    primary: md.body,
    text: md.body,
    format: 'markdown',
    copyMode: 'markdown',
    warnings,
    stats: [
      { label: '正文', value: `${charCount(md.body)} 字符` },
      { label: '图片', value: `${images.length} 张` },
      { label: '外链', value: `${links.length} 个` },
    ],
    fileName: `${slug || 'article'}.md`,
  }
}
