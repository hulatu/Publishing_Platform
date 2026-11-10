/**
 * IR → 带 inline style 的 HTML
 *
 * 这套引擎同时服务公众号和豆瓣，靠 options 区分行为：
 * - 公众号：linkMode='refs'（外链全部抽到文末编号表）、useHeadingTags=false
 *   （用 <section> 而非 <h2>，绕开微信编辑器对标题标签的默认样式）
 * - 豆瓣：linkMode='inline'（保留 <a>）、useHeadingTags=true
 *
 * 公众号的硬约束（每一条都对应一个真实的踩坑）：
 * 1. 不能用 <pre> —— 微信移动端不支持横向滚动，overflow-x 会被剥离导致代码被截断
 * 2. 不能写 class / id / <style> —— 微信编辑器会整体剥离
 * 3. 不能预置 data-src —— 微信自己会写回，预置会被当懒加载占位导致图不显示
 * 4. 间距必须四值显式 margin —— 只写 margin-bottom 会与微信默认 p margin 叠加
 * 5. 外链 <a> 在未认证号正文里整体失效 —— 所以抽成文末参考链接
 * 6. HTML 越小粘得越快 —— 全局样式挂外层 <section> 靠继承，段落只写差异
 */

import type { Align, Block, ImageRef, Inline, LinkRef } from './ir'
import { collectImages, collectLinks, imageCaption, inlineText } from './ir'
import { blocksToText } from './ir'

export type StyleMap = Record<string, string>

export interface HtmlTheme {
  id: string
  name: string
  /** 主题选择器里的分组名（可选，仅用于界面归类） */
  group?: string
  /** 一句话说明，显示在选择卡片上 */
  hint?: string
  /** 三色示意（底 / 强调 / 正文），只给选择器画色点用，不参与渲染 */
  swatch?: { bg: string; accent: string; ink: string }
  /** 外层容器：字体、行高、字距、颜色全靠这里继承 */
  root: StyleMap
  heading: { 2: StyleMap; 3: StyleMap; 4: StyleMap }
  p: StyleMap
  strong: StyleMap
  em: StyleMap
  del: StyleMap
  inlineCode: StyleMap
  link: StyleMap
  /** 文末参考链接编号（公众号替代 <a> 的方案） */
  linkMark: StyleMap
  imgBlock: StyleMap
  imgInline: StyleMap
  caption: StyleMap
  quote: StyleMap
  quoteP: StyleMap
  list: StyleMap
  listItem: StyleMap
  codeBlock: StyleMap
  codeLine: StyleMap
  table: StyleMap
  th: StyleMap
  td: StyleMap
  hr: StyleMap
  refsTitle: StyleMap
  refsItem: StyleMap
  fnTitle: StyleMap
  fnItem: StyleMap
  /**
   * H2 自动编号。
   * 公众号会把 `::before` 伪元素整条剥掉，所以编号只能在渲染时作为
   * 真实 <span> 注入；不设此项则不加编号。
   */
  headingIndex?: { format: 'pad' | 'plain'; style: StyleMap }
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function attr(map: StyleMap): string {
  const body = Object.entries(map)
    .filter(([, v]) => v !== '' && v !== undefined)
    // 值里可能出现双引号（font-family: "PingFang SC"）。不转义的话 style="..."
    // 会从引号处被截断，后面所有声明都被浏览器当成非法属性丢弃 ——
    // 表现为「只有第一条样式生效」，极难往属性编码上想。
    .map(([k, v]) => `${k}:${String(v).replace(/"/g, '&quot;')}`)
    .join(';')
  return body ? ` style="${body}"` : ''
}

function joinStyles(...maps: (StyleMap | undefined)[]): StyleMap {
  const out: StyleMap = {}
  for (const m of maps) if (m) Object.assign(out, m)
  return out
}

/* ------------------------------------------------------------------ */
/* 渲染上下文                                                          */
/* ------------------------------------------------------------------ */

export interface HtmlRenderOptions {
  theme: HtmlTheme
  /** refs：外链抽到文末；inline：保留 <a> */
  linkMode: 'refs' | 'inline'
  /**
   * 输出目标，决定三处结构性差异：
   * - wechat：标题用 <section>、代码用逐行 section、分隔线用 section
   *           （绕开微信编辑器对 h 标签与 pre 的默认处理）
   * - web：标题用 <h2>、代码用 <pre>、分隔线用 <hr>（豆瓣等标准 HTML 环境）
   */
  target: 'wechat' | 'web'
  refsTitle?: string
  fnTitle?: string
}

interface Ctx {
  opts: HtmlRenderOptions
  theme: HtmlTheme
  refs: LinkRef[]
  refIndex: Map<string, number>
  fnOrder: string[]
  fnMap: Map<string, Block & { t: 'fn' }>
  warnings: string[]
  /** H2 计数器（编号主题用）；用对象是为了能在渲染过程中原地累加 */
  h2: { n: number }
}

/* ------------------------------------------------------------------ */
/* Inline 渲染                                                         */
/* ------------------------------------------------------------------ */

function renderInline(nodes: Inline[], ctx: Ctx): string {
  const { theme } = ctx
  let out = ''

  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out += escapeHtml(n.v)
        break

      case 'strong':
        out += `<strong${attr(theme.strong)}>${renderInline(n.c, ctx)}</strong>`
        break

      case 'em':
        out += `<em${attr(theme.em)}>${renderInline(n.c, ctx)}</em>`
        break

      case 'del':
        out += `<del${attr(theme.del)}>${renderInline(n.c, ctx)}</del>`
        break

      case 'code':
        out += `<code${attr(theme.inlineCode)}>${escapeHtml(n.v)}</code>`
        break

      case 'link': {
        const inner = renderInline(n.c, ctx)
        if (ctx.opts.linkMode === 'inline') {
          out += `<a href="${escapeHtml(n.href)}"${attr(theme.link)}>${inner}</a>`
          break
        }
        // 公众号：正文只留文字 + 编号上标，URL 收到文末
        let idx = ctx.refIndex.get(n.href)
        if (idx === undefined) {
          ctx.refs.push({ href: n.href, text: inlineText(n.c) || n.href })
          idx = ctx.refs.length
          ctx.refIndex.set(n.href, idx)
        }
        out += `${inner}<span${attr(theme.linkMark)}>[${idx}]</span>`
        break
      }

      case 'img':
        out += `<img src="${escapeHtml(n.src)}" alt="${escapeHtml(n.alt)}"${attr(theme.imgInline)}>`
        break

      case 'br':
        out += '<br>'
        break

      case 'fnref': {
        if (!ctx.fnOrder.includes(n.id)) ctx.fnOrder.push(n.id)
        const idx = ctx.fnOrder.indexOf(n.id) + 1
        // 脚注用 [注n]，和外链的 [n] 区分开 —— 两边都从 1 开始编，
        // 不区分的话同一篇文章里会出现两个 [1]，一个是注释、一个是参考链接
        out += `<sup${attr(theme.linkMark)}>[注${idx}]</sup>`
        break
      }

      case 'html':
        out += n.raw
        break
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Block 渲染                                                          */
/* ------------------------------------------------------------------ */

function alignStyle(a: Align): string {
  return a === 'l' ? 'left' : a === 'c' ? 'center' : a === 'r' ? 'right' : 'left'
}

function renderHeading(b: Block & { t: 'heading' }, ctx: Ctx): string {
  const { theme, opts } = ctx
  const style = theme.heading[b.level] ?? theme.heading[2]
  let inner = renderInline(b.inline, ctx)

  // H2 编号：只给二级标题编，H3/H4 是二级下的细分，编号反而乱
  const idx = theme.headingIndex
  if (idx && b.level === 2) {
    // 标题自己已经带编号（「二、」「3.」）时不再叠加，否则会变成「02二、拆成两段」
    const alreadyNumbered = /^\s*([0-9]+|[一二三四五六七八九十百]+)\s*[、.．)）]/.test(
      inlineText(b.inline),
    )
    if (!alreadyNumbered) {
      ctx.h2.n += 1
      const label = idx.format === 'pad' ? String(ctx.h2.n).padStart(2, '0') : String(ctx.h2.n)
      inner = `<span${attr(idx.style)}>${label}</span>${inner}`
    }
  }

  if (opts.target === 'web') {
    const tag = `h${b.level}`
    return `<${tag}${attr(style)}>${inner}</${tag}>`
  }
  return `<section${attr(style)}>${inner}</section>`
}

function renderParagraph(inline: Inline[], ctx: Ctx, inQuote = false): string {
  // 整段只有图 → 每张图各配一条图注（引用块里同样适用，figure 是并列块不会破结构）
  const only = imagesOnly(inline)
  if (only) return only.map((img) => renderFigure(img, ctx)).join('')

  const style = inQuote ? joinStyles(ctx.theme.p, ctx.theme.quoteP) : ctx.theme.p
  return `<p${attr(style)}>${renderInline(inline, ctx)}</p>`
}

function renderCode(b: Block & { t: 'code' }, ctx: Ctx): string {
  const { theme, opts } = ctx
  if (opts.target === 'web') {
    // 标准 HTML 环境（豆瓣等）直接用 <pre>
    return `<pre${attr(theme.codeBlock)}>${escapeHtml(b.text)}</pre>`
  }
  // 公众号：<pre> 的 overflow-x 会被剥离导致代码被截断，改逐行 section
  const lines = b.text.split('\n')
  const body = lines
    .map((line) => (line ? `<section>${escapeHtml(line)}</section>` : '<section><br></section>'))
    .join('')
  return `<section${attr(theme.codeBlock)}>${body}</section>`
}

function renderImageBlock(b: Block & { t: 'img' }, ctx: Ctx): string {
  return renderFigure(b, ctx)
}

/**
 * 图 + 图注。
 *
 * 为什么图注要跟图做成**两个并列块**而不是嵌套：
 * - 公众号（section）：嵌套合法，但 `<p>` 里再套 `<p>` 不合法，豆瓣那一路会
 *   被浏览器自动闭合，外层 `text-align:center` 直接失效
 * - 所以统一「图一个块、图注一个块」，两个都居中，图注靠自己的 margin-top 贴住图
 *
 * 图注文字见 `imageCaption()`：有 alt 用 alt，没有就退回文件名。
 */
function renderFigure(img: { src: string; alt: string }, ctx: Ctx): string {
  const { theme, opts } = ctx
  const wrapper = opts.target === 'web' ? 'p' : 'section'
  const el = `<img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}"${attr(theme.imgBlock)}>`
  const name = imageCaption(img.src, img.alt)

  if (!name) {
    return `<${wrapper} style="margin:0 0 1.6em;text-align:center;">${el}</${wrapper}>`
  }

  // 图注自带 margin-top（贴住图片），补一个下边距把「一张图」整体撑开
  const capStyle = joinStyles(theme.caption, { 'margin-bottom': '1.6em' })
  return (
    `<${wrapper} style="margin:1.6em 0 0;text-align:center;">${el}</${wrapper}>` +
    `<${wrapper}${attr(capStyle)}>${escapeHtml(name)}</${wrapper}>`
  )
}

/**
 * 段落里是不是「只有图」——返回这些图；夹了文字就返回 null。
 *
 * Markdown 里 `![说明](x)` 单独占一行时，markdown-it 产出的是
 * `<p><img></p>` —— 图片是 inline，不会变成独立的 img block。
 * 不在这里识别的话，图注逻辑永远不会触发。
 *
 * 允许夹空白文本与 `<br>`（有些作者会在图片前后多敲一个换行）；
 * 也允许连着好几张图（`breaks: false` 时相邻两行图片会落进同一个段落，
 * 这时每张图各配一条图注，而不是整段放弃）。
 */
function imagesOnly(inline: Inline[]): (Inline & { t: 'img' })[] | null {
  const imgs: (Inline & { t: 'img' })[] = []
  for (const n of inline) {
    if (n.t === 'text' && !n.v.trim()) continue
    if (n.t === 'br') continue
    if (n.t === 'img') {
      imgs.push(n)
      continue
    }
    return null
  }
  return imgs.length > 0 ? imgs : null
}

function renderList(b: Block & { t: 'list' }, ctx: Ctx): string {
  const { theme } = ctx
  const tag = b.ordered ? 'ol' : 'ul'
  const style = joinStyles(theme.list, b.ordered ? { 'list-style-type': 'decimal' } : { 'list-style-type': 'disc' })

  const items = b.items
    .map((item) => {
      // 紧凑列表：首段直接内联，避免多套一层 <p> 造成过大行距
      const parts: string[] = []
      let first = true
      for (const blk of item) {
        if (first && blk.t === 'p') {
          parts.push(renderInline(blk.inline, ctx))
          first = false
          continue
        }
        first = false
        parts.push(renderBlocks([blk], ctx))
      }
      const content = parts.join('')
      // 嵌套列表已在 renderBlocks 里生成，这里不能再套 li
      return `<li${attr(theme.listItem)}>${content}</li>`
    })
    .join('')

  return `<${tag}${attr(style)}>${items}</${tag}>`
}

function renderQuote(b: Block & { t: 'quote' }, ctx: Ctx): string {
  const { theme } = ctx
  const inner = b.children
    .map((child) => (child.t === 'p' ? renderParagraph(child.inline, ctx, true) : renderBlocks([child], ctx)))
    .join('')
  return `<section${attr(theme.quote)}>${inner}</section>`
}

function renderTable(b: Block & { t: 'table' }, ctx: Ctx): string {
  const { theme } = ctx
  const head = `<thead><tr>${b.head
    .map((cell, i) => `<th${attr(joinStyles(theme.th, { 'text-align': alignStyle(b.align[i] ?? null) }))}>${renderInline(cell, ctx)}</th>`)
    .join('')}</tr></thead>`
  const body = b.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell, i) =>
              `<td${attr(joinStyles(theme.td, { 'text-align': alignStyle(b.align[i] ?? null) }))}>${renderInline(cell, ctx)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('')
  return `<table${attr(theme.table)}>${head}<tbody>${body}</tbody></table>`
}

function renderBlocks(blocks: Block[], ctx: Ctx): string {
  const { theme } = ctx
  let out = ''

  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
        out += renderHeading(b, ctx)
        break
      case 'p':
        out += renderParagraph(b.inline, ctx)
        break
      case 'code':
        out += renderCode(b, ctx)
        break
      case 'img':
        out += renderImageBlock(b, ctx)
        break
      case 'list':
        out += renderList(b, ctx)
        break
      case 'quote':
        out += renderQuote(b, ctx)
        break
      case 'table':
        out += renderTable(b, ctx)
        break
      case 'hr':
        out +=
          ctx.opts.target === 'web'
            ? `<hr${attr(theme.hr)}>`
            : `<section${attr(theme.hr)}></section>`
        break
      case 'html':
        out += b.raw
        break
      case 'fn':
        // 脚注统一在文末渲染，这里跳过
        break
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* 文末区块：参考链接 / 脚注                                            */
/* ------------------------------------------------------------------ */

function renderRefs(ctx: Ctx): string {
  if (ctx.refs.length === 0) return ''
  const { theme, opts } = ctx
  const title = `<section${attr(theme.refsTitle)}>${escapeHtml(opts.refsTitle ?? '参考链接')}</section>`
  const items = ctx.refs
    .map(
      (r, i) =>
        `<section${attr(theme.refsItem)}>[${i + 1}] ${escapeHtml(r.text)}<br><span style="color:#8a8a8a;word-break:break-all;">${escapeHtml(r.href)}</span></section>`,
    )
    .join('')
  return title + items
}

function renderFootnotes(ctx: Ctx): string {
  if (ctx.fnOrder.length === 0) return ''
  const { theme, opts } = ctx
  const title = `<section${attr(theme.fnTitle)}>${escapeHtml(opts.fnTitle ?? '注释')}</section>`
  const items = ctx.fnOrder
    .map((id, i) => {
      const fn = ctx.fnMap.get(id)
      const text = fn ? blocksToText(fn.children) : ''
      if (!fn) ctx.warnings.push(`脚注 [^${id}] 在正文里被引用但找不到定义`)
      // 和正文里的上标一致：脚注是 [注n]，外链是 [n]，不共用编号
      return `<section${attr(theme.fnItem)}>[注${i + 1}] ${escapeHtml(text)}</section>`
    })
    .join('')
  return title + items
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

export interface HtmlRenderResult {
  html: string
  text: string
  charCount: number
  images: ImageRef[]
  links: LinkRef[]
  warnings: string[]
}

export function renderHtml(blocks: Block[], opts: HtmlRenderOptions): HtmlRenderResult {
  const fnMap = new Map<string, Block & { t: 'fn' }>()
  for (const b of blocks) if (b.t === 'fn') fnMap.set(b.id, b)

  const ctx: Ctx = {
    opts,
    theme: opts.theme,
    refs: [],
    refIndex: new Map(),
    fnOrder: [],
    fnMap,
    warnings: [],
    h2: { n: 0 },
  }

  const body = renderBlocks(blocks, ctx)
  const tail = renderFootnotes(ctx) + renderRefs(ctx)

  // 外层 <section> 承载全局样式，靠继承压缩体积（粘贴时少传一半字节）
  const html = `<section${attr(opts.theme.root)}>${body}${tail}</section>`

  const text = blocksToText(blocks)

  return {
    html,
    text,
    charCount: html.length,
    images: collectImages(blocks),
    links: collectLinks(blocks),
    warnings: ctx.warnings,
  }
}
