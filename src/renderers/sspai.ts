/**
 * 少数派（sspai.com）
 *
 * 少数派编辑器是基于富文本的（文章里的图片就是 `<figure><img><figcaption>`），
 * 同时也能识别粘贴进来的 Markdown。两条出口都提供，但**实际以纯文本 Markdown 为主**：
 *
 * - 它的粘贴处理优先拿剪贴板里的 text/plain 做 Markdown 转换，裸 HTML 会被转义。
 *   所以 Markdown 里不能写 figure —— 否则正文里会出现一串 `<figure>` 源码。
 * - Markdown 的 `![alt](url)` 里的 alt 又不会变成图注，折中成「图 + 图下方一行斜体图注」，
 *   斜体是 Markdown 原生语法，任何转换器都认。
 * - 富文本那条仍带 figure + figcaption：编辑器如果采用 HTML，图注就是原生图注；
 *   如果采用 text/plain（目前实测是这条），就是上面那行斜体。
 *
 * 图片仍走外链，和原先一样，不替用户转存。
 */

import type { Doc } from '../core/ir'
import { collectImages, collectLinks } from '../core/ir'
import { toMarkdown } from '../core/markdown-out'
import { renderHtml } from '../core/html-inline'
import { charCount } from '../core/cjk'
import { doubanTheme } from '../themes/wechat'
import type { ConvertOptions, RenderOutput } from './index'

/**
 * 少数派编辑器会在 `clipboardInput` 里拿剪贴板的 HTML 去跑 5 条 Markdown 正则
 * （标题 / 链接 / 有序无序列表 / 引用）；命中就弹「Markdown 格式转换」，
 * 而那个弹窗的「立即转换」依赖 text/plain 的 `pcontent`——我们只写 HTML 时它是空的，
 * 按钮就会静默失败、卡死在弹窗里。
 *
 * 这里把会命中的字符全部写成 HTML 实体：渲染结果不变（解析时还原），
 * 但正则看到的是 `&#91;` / `&#40;` / `&#10;`，不会再误判。
 * 换行也编码掉，顺带满足它「少于 5 行就直接放行」的早退条件。
 */
function hardenSspaiHtml(html: string): string {
  return html
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;')
    .replace(/\(/g, '&#40;')
    .replace(/\)/g, '&#41;')
    .replace(/\r?\n/g, '&#10;')
}

export function renderSspai(doc: Doc, _opts: ConvertOptions): RenderOutput {
  // Markdown 走「图 + 斜体图注」，避免裸 HTML 被编辑器转义成源码；
  // 富文本仍用 figure，编辑器若采用 HTML 就是原生图注。
  const md = toMarkdown(doc.blocks, undefined, { captionLines: true })
  const rich = renderHtml(doc.blocks, {
    theme: doubanTheme,
    linkMode: 'inline',
    target: 'web',
    figureImages: true,
    // CKEditor 的图片组件只认 figure.image；ss-img-wrapper 是少数派自己的包裹类。
    figureClass: 'image ss-img-wrapper',
  })
  const images = collectImages(doc.blocks)
  const links = collectLinks(doc.blocks)
  const warnings: string[] = []

  if (links.length > 0) {
    warnings.push(`正文含 ${links.length} 个外链，导入后抽查几个是否被正确解析`)
  }

  const slug = doc.meta.slug || doc.meta.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

  return {
    primary: md.body,
    html: hardenSspaiHtml(rich.html),
    text: md.body,
    format: 'markdown',
    copyMode: 'rich',
    // 有 text/plain 时少数派会走自带的 Markdown 转换，HTML 永远轮不到；
    // 只写 HTML，图注才能进它的「图片标注框」。
    htmlOnly: true,
    warnings,
    stats: [
      { label: '正文', value: `${charCount(md.body)} 字符` },
      { label: '图片', value: `${images.length} 张` },
      { label: '外链', value: `${links.length} 个` },
    ],
    fileName: `${slug || 'article'}.md`,
  }
}
