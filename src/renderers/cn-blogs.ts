/**
 * B 站专栏 / 头条号 / 百家号
 *
 * 这三个都是「富文本编辑器 + 手动上传图片」的路子，和豆瓣同一类，
 * 所以共用一套渲染：标准 HTML 标签（target='web'）、不用 section 包正文。
 *
 * 三家的差别只有两点，按这两点分叉：
 *
 * 1. **正文外链**：B 站专栏允许插入链接；头条和百家号会把正文里的 <a> 清掉。
 *    所以前者用 linkMode='inline'，后者用 'refs'（把 URL 抽到文末当纯文本列出，
 *    至少读者还能看见地址）。
 * 2. **代码块**：三家都不保证保留等宽格式。B 站专栏会把代码压成普通段落，
 *    头条和百家号连 <pre> 都会剥。遇到代码块统一提示「粘贴后需检查格式」。
 *
 * 图片走外链就行 —— 这三家过去被认为有图床防盗链、外链图粘过去会裂，
 * 但实测自建图床（Cloudflare R2 + 自有域名）在这几家都能正常显示，
 * 所以不再提示「逐张手动上传」。
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
  bilibili: {
    inlineLinks: true,
    codeHint: '代码块粘进专栏后会变成普通段落，等宽对齐会丢，建议先截图再贴',
    notes: ['B 站专栏编辑器支持富文本粘贴，标题层级与表格保真'],
  },
  toutiao: {
    inlineLinks: false,
    codeHint: '代码块在头条编辑器里会被清洗成普通文字',
    notes: [
      '头条号粘贴后会把字号、行距、颜色全部归一化，这里排的样式只作参考',
      '正文里的外链会被清除，已抽成文末「参考链接」纯文本',
    ],
  },
  baijiahao: {
    inlineLinks: false,
    codeHint: '百家号会剥掉 <pre>，代码只能以纯文本呈现',
    notes: [
      '百家号的清洗最狠，只保留段落、加粗、标题、图片等基础标签',
      '正文外链会被清除，已抽成文末「参考链接」纯文本',
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

export const renderBilibili = (doc: Doc, opts: ConvertOptions) => renderCnBlog('bilibili', doc, opts)
export const renderToutiao = (doc: Doc, opts: ConvertOptions) => renderCnBlog('toutiao', doc, opts)
export const renderBaijiahao = (doc: Doc, opts: ConvertOptions) => renderCnBlog('baijiahao', doc, opts)
