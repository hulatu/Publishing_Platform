/**
 * 头条号
 *
 * 和豆瓣同一类：富文本编辑器 + 手动上传图片，所以用标准 HTML 标签
 * （target='web'）、不用 section 包正文。
 *
 * 头条的特殊之处只有两点：
 *
 * 1. **正文外链**：会把正文里的 <a> 清掉，所以用 linkMode='refs'
 *    （把 URL 抽到文末当纯文本列出，至少读者还能看见地址）。
 * 2. **代码块**：不保证保留等宽格式，遇到代码块提示「粘贴后需检查格式」。
 *
 * 图片走外链就行 —— 实测自建图床（Cloudflare R2 + 自有域名）能正常显示，
 * 不再提示「逐张手动上传」。
 */

import type { Doc } from '../core/ir'
import { collectImages, collectLinks } from '../core/ir'
import { renderHtml } from '../core/html-inline'
import { charCount } from '../core/cjk'
import { doubanTheme } from '../themes/wechat'
import type { ConvertOptions, RenderOutput } from './index'

interface Spec {
  /** 正文外链能不能留 */
  inlineLinks: boolean
  /** 平台对代码块的处置，用于提示文案 */
  codeHint: string
  /** 额外的固定提示 */
  notes: string[]
}

const SPECS = {
  toutiao: {
    inlineLinks: false,
    codeHint: '代码块在头条编辑器里会被清洗成普通文字',
    notes: [
      '头条号粘贴后会把字号、行距、颜色全部归一化，这里排的样式只作参考',
      '正文里的外链会被清除，已抽成文末「参考链接」纯文本',
    ],
  },
} satisfies Record<string, Spec>

export type CnBlogId = keyof typeof SPECS

export function renderCnBlog(id: CnBlogId, doc: Doc, _opts: ConvertOptions): RenderOutput {
  const spec = SPECS[id]

  const result = renderHtml(doc.blocks, {
    theme: doubanTheme,
    linkMode: spec.inlineLinks ? 'inline' : 'refs',
    target: 'web',
    refsTitle: '参考链接',
    fnTitle: '注释',
  })

  const images = collectImages(doc.blocks)
  const links = collectLinks(doc.blocks)
  const hasCode = doc.blocks.some((b) => b.t === 'code')

  const warnings: string[] = []
  if (hasCode) warnings.push(spec.codeHint)
  if (!spec.inlineLinks && links.length > 0) {
    warnings.push(`${links.length} 个外链已抽成文末参考链接（正文外链会被清除）`)
  }

  return {
    primary: result.html,
    html: result.html,
    text: result.text,
    format: 'html',
    copyMode: 'rich',
    warnings: [...warnings, ...spec.notes, ...result.warnings],
    stats: [
      { label: '正文', value: `${charCount(result.text)} 字` },
      { label: 'HTML', value: `${result.charCount} 字符` },
      { label: '图片', value: `${images.length} 张` },
      { label: '外链', value: spec.inlineLinks ? `${links.length} 个保留` : `${links.length} 个转文末` },
    ],
    fileName: `${doc.meta.slug || 'article'}.html`,
  }
}

export const renderToutiao = (doc: Doc, opts: ConvertOptions) => renderCnBlog('toutiao', doc, opts)
