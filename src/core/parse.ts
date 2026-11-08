/**
 * Markdown → IR
 *
 * 关于 markdown-it 的配置选择：
 * - `html: true` 是刻意的。若设 false，正文里的 `<iframe>`、`<script>` 会作为可见文本
 *   漏进段落（博客里有 2 个腾讯视频 iframe 和 1 个 Twikoo script），反而更糟。
 *   打开 html 后由 sanitizeHtml 统一清洗，iframe 在预处理阶段就降级成「视频链接」文本。
 * - `linkify: false` / `breaks: false`：与 Hugo goldmark 默认行为一致，
 *   避免单换行被转成 <br> 导致段落结构与博客不一致。
 * - `typographer: false`：绝不替换中文全角标点与「」引号。
 */

import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import type { Align, Block, Doc, Inline } from './ir'
import { buildMeta, parseFrontMatter, splitFrontMatter } from './frontmatter'
import { blocksToText, imageCaption } from './ir'

/* ------------------------------------------------------------------ */
/* 最小化的 token 结构（避免依赖 @types/markdown-it 的内部类型路径）      */
/* ------------------------------------------------------------------ */

interface MdToken {
  type: string
  tag: string
  attrs: [string, string][] | null
  map: [number, number] | null
  nesting: number
  level: number
  children: MdToken[] | null
  content: string
  markup: string
  info: string
  meta: Record<string, unknown> | null
  hidden: boolean
  block: boolean
}

/* ------------------------------------------------------------------ */
/* markdown-it 实例                                                    */
/* ------------------------------------------------------------------ */

const md = new MarkdownIt({
  html: true,
  linkify: false,
  breaks: false,
  typographer: false,
})
md.use(footnote)

/* ------------------------------------------------------------------ */
/* 脚注：没人引用的定义不能被丢掉                                        */
/*                                                                     */
/* markdown-it-footnote 的 `footnote_tail` 只有在 `env.footnotes.list`   */
/* 存在时才吐出定义块，而 `list` 只在「某个 `[^x]` 被成功解析成引用」时   */
/* 才会被创建。于是两种情况下定义会整块消失、连原文都不剩：              */
/*   1. 作者写了 `[^1]: …` 但忘了在正文里引用；                          */
/*   2. 引用的写法 markdown-it 不认（例如写在代码块里），引用没成立。    */
/* 对转换器来说这是静默的数据丢失 —— 一段参考书目就这么没了。            */
/*                                                                     */
/* 修法：在 `footnote_tail` 之前，把「有定义、没被引用」的标签补进 list， */
/* 让它们照常出现在文末（排在已引用的之后），并记下标签供上层提示。      */
/* ------------------------------------------------------------------ */

const ORPHAN_FN_KEY = '__mvOrphanFn'

interface FootnoteEnv {
  footnotes?: { refs?: Record<string, number>; list?: { label?: string; count?: number }[] }
  [ORPHAN_FN_KEY]?: string[]
}

md.core.ruler.before('footnote_tail', 'mv_footnote_orphans', (state) => {
  const env = state.env as FootnoteEnv
  const fn = env.footnotes
  if (!fn?.refs) return

  const list = (fn.list ??= [])
  const known = new Set(list.map((x) => x.label))
  const orphans: string[] = []

  for (const key of Object.keys(fn.refs)) {
    if (fn.refs[key] >= 0) continue // 已被引用过，list 里已经有它
    const label = key.slice(1) // refs 的键统一带一个前导冒号（避开 Object 原型成员）
    if (!label || known.has(label)) continue
    list.push({ label, count: 0 })
    known.add(label)
    orphans.push(label)
  }

  if (orphans.length) env[ORPHAN_FN_KEY] = orphans
})

/* ------------------------------------------------------------------ */
/* 预览渲染：独立成段的图片 → <figure> + 图注                            */
/*                                                                     */
/* 只影响「渲染」，不影响 tokenize —— parseArticle 读的是 token，不受干扰。 */
/* 图注的居中 / 灰字 / 小字号写在 global.css 的 .md-preview figcaption 里。 */
/* ------------------------------------------------------------------ */

const SOLE_IMG_KEY = '__mvSoleImg'

/** 这个 inline token 是不是「只有图」（允许夹空白、换行，也允许多张） */
function isSoleImageInline(token: { children?: unknown[] | null }): boolean {
  const kids = (token.children ?? []) as { type: string; content?: string }[]
  let found = false
  for (const k of kids) {
    if (k.type === 'text' && !String(k.content ?? '').trim()) continue
    if (k.type === 'softbreak' || k.type === 'hardbreak') continue
    if (k.type === 'image') {
      found = true
      continue
    }
    return false
  }
  return found
}

/* eslint-disable @typescript-eslint/no-explicit-any */
md.renderer.rules.paragraph_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  const next = tokens[idx + 1]
  const sole = !!next && next.type === 'inline' && isSoleImageInline(next)
  env[SOLE_IMG_KEY] = sole
  return sole ? '' : self.renderToken(tokens, idx, options)
}

md.renderer.rules.paragraph_close = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  const sole = env[SOLE_IMG_KEY] === true
  env[SOLE_IMG_KEY] = false
  return sole ? '' : self.renderToken(tokens, idx, options)
}

md.renderer.rules.image = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx]
  // markdown-it 默认把 alt 填进 attrs；这里先按默认行为补上，再决定要不要包 figure
  const altText = self.renderInlineAsText(token.children ?? [], options, env)
  const altIdx = token.attrIndex('alt')
  if (altIdx >= 0 && token.attrs) token.attrs[altIdx][1] = altText

  const img = self.renderToken(tokens, idx, options)
  if (env[SOLE_IMG_KEY] !== true) return img

  const name = imageCaption(token.attrGet('src') ?? '', altText)
  const cap = name ? `<figcaption>${escapeText(name)}</figcaption>` : ''
  return `<figure class="md-figure">${img}${cap}</figure>`
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ------------------------------------------------------------------ */
/* 预处理：处理无法安全进入 IR 的裸 HTML                                 */
/* ------------------------------------------------------------------ */

const BLOCKED_TAGS = 'script|style|iframe|object|embed|noscript'

/**
 * 清洗裸 HTML：移除危险标签、事件属性，以及 class / id。
 *
 * `keepClasses` 只给站内阅读预览用 —— 预览渲染在我们自己的页面里，
 * class 有用（脚注、表格的对齐都要靠它）；而交给微信的那份必须剥干净。
 */
export function sanitizeHtml(raw: string, opts: { keepClasses?: boolean } = {}): string {
  let out = raw
    .replace(new RegExp(`<(${BLOCKED_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), '')
    .replace(new RegExp(`</?(${BLOCKED_TAGS})\\b[^>]*>`, 'gi'), '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '')

  // class / id 必须剥掉：微信编辑器会静默丢弃它们，留着只会让人误以为样式生效；
  // 而 style 是唯一能在微信里活下来的内联属性，保留。
  if (!opts.keepClasses) {
    out = out.replace(/\s(class|id)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  }
  return out
}

export interface PreprocessResult {
  src: string
  warnings: string[]
}

/** 预处理正文：iframe 降级为链接文本，script/style 移除 */
export function preprocess(src: string): PreprocessResult {
  const warnings: string[] = []
  let out = src

  // <script> / <style> 整块移除
  const beforeScripts = out
  out = out.replace(new RegExp(`<(${BLOCKED_TAGS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), '')
  if (out !== beforeScripts) {
    warnings.push('正文内嵌的 script / style 代码块已移除（公众号与知乎都不支持）')
  }

  // iframe 降级为一行链接
  let iframeCount = 0
  out = out.replace(/<iframe\b[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>\s*<\/iframe>/gi, (_m, url: string) => {
    iframeCount++
    return `\n\n视频链接：${url}\n\n`
  })
  if (iframeCount > 0) {
    warnings.push(`正文里的 ${iframeCount} 个内嵌视频已降级为链接文本（各平台编辑器不支持 iframe）`)
  }
  // 残留的孤立 iframe 开标签直接去掉
  out = out.replace(/<\/?iframe\b[^>]*>/gi, '')

  // Hugo / Pandoc 的标题属性：`## 标题 {#anchor .cls}`。
  // 这是渲染期指令，Goldmark 会把它变成 id 而不显示；但 markdown-it 会当成正文，
  // 结果 `{#first-section}` 原样出现在公众号、少数派、知乎的标题里。
  // 静默去掉即可 —— 它本来就不该被读者看见，报成「提示」只会制造噪音。
  out = out.replace(/^([ \t]{0,3}#{1,6}[ \t]+.*?)[ \t]*\{(?:[#.][\w:-]+)(?:[ \t]+[#.][\w:-]+)*\}[ \t]*$/gm, '$1')

  return { src: out, warnings }
}

/* ------------------------------------------------------------------ */
/* 解析游标                                                            */
/* ------------------------------------------------------------------ */

class Cursor {
  i = 0
  constructor(
    readonly tokens: MdToken[],
    readonly lines: string[],
  ) {}

  peek(): MdToken | undefined {
    return this.tokens[this.i]
  }

  next(): MdToken | undefined {
    return this.tokens[this.i++]
  }
}

function rawOf(tok: MdToken, lines: string[]): string {
  if (!tok.map) return ''
  const [start, end] = tok.map
  return lines.slice(start, end).join('\n')
}

function attrOf(tok: MdToken, name: string): string | undefined {
  return tok.attrs?.find((a) => a[0] === name)?.[1]
}

/* ------------------------------------------------------------------ */
/* Inline 解析                                                         */
/* ------------------------------------------------------------------ */

function parseInline(tokens: MdToken[]): Inline[] {
  let i = 0

  const walk = (stop: string): Inline[] => {
    const out: Inline[] = []
    while (i < tokens.length) {
      const tok = tokens[i]
      if (tok.type === stop) return out

      switch (tok.type) {
        case 'text':
          out.push({ t: 'text', v: tok.content })
          i++
          break

        case 'code_inline':
          out.push({ t: 'code', v: tok.content })
          i++
          break

        case 'strong_open': {
          i++
          const c = walk('strong_close')
          if (tokens[i]?.type === 'strong_close') i++
          out.push({ t: 'strong', c })
          break
        }

        case 'em_open': {
          i++
          const c = walk('em_close')
          if (tokens[i]?.type === 'em_close') i++
          out.push({ t: 'em', c })
          break
        }

        case 's_open': {
          i++
          const c = walk('s_close')
          if (tokens[i]?.type === 's_close') i++
          out.push({ t: 'del', c })
          break
        }

        case 'link_open': {
          const href = attrOf(tok, 'href') ?? ''
          i++
          const c = walk('link_close')
          if (tokens[i]?.type === 'link_close') i++
          out.push({ t: 'link', href, c })
          break
        }

        case 'image': {
          const src = attrOf(tok, 'src') ?? ''
          // ⚠️ alt 不在 attrs 里 —— markdown-it 把 `![这里](x)` 的文字放在
          // token.content，attrs 里那条 alt 恒为空串。只读 attrs 会让全文图片
          // 的说明文字静默丢失（图注、少数派 Markdown 输出都会变空）。
          const alt = attrOf(tok, 'alt') || tok.content || ''
          const title = attrOf(tok, 'title')
          out.push({ t: 'img', src, alt, ...(title ? { title } : {}) })
          i++
          break
        }

        case 'softbreak':
          // 中文段落内的软换行不应产生空格
          i++
          break

        case 'hardbreak':
          out.push({ t: 'br' })
          i++
          break

        case 'html_inline': {
          const clean = sanitizeHtml(tok.content)
          if (clean.trim()) out.push({ t: 'html', raw: clean })
          i++
          break
        }

        case 'footnote_ref': {
          // label 是作者写的标记（`[^1]` 的 1），id 是内部序号 —— 两个都留着，
          // Markdown 出口必须用 label 才能和 `[^1]:` 的定义对上
          const label = String(tok.meta?.label ?? '')
          out.push({ t: 'fnref', id: String(tok.meta?.id ?? ''), ...(label ? { label } : {}) })
          i++
          break
        }

        case 'footnote_anchor':
          i++
          break

        default:
          // 未知 inline token：把内容当纯文本保底，避免丢字
          if (tok.content) out.push({ t: 'text', v: tok.content })
          i++
          break
      }
    }
    return out
  }

  return walk('')
}

/* ------------------------------------------------------------------ */
/* Block 解析                                                          */
/* ------------------------------------------------------------------ */

function parseBlocks(cur: Cursor, stopTypes: ReadonlySet<string>): Block[] {
  const out: Block[] = []

  while (cur.i < cur.tokens.length) {
    const tok = cur.peek()
    if (!tok) break
    if (stopTypes.has(tok.type)) break

    switch (tok.type) {
      /* ---------------- 标题 ---------------- */
      case 'heading_open': {
        // H1 统一降为 H2：正文 H1 会抢掉公众号/知乎的标题位
        const rawLevel = Number(tok.tag.slice(1)) || 2
        const level = Math.min(4, Math.max(2, rawLevel)) as 2 | 3 | 4
        const raw = rawOf(tok, cur.lines)
        cur.next()
        const inlineTok = cur.peek()
        const inline = inlineTok?.type === 'inline' ? parseInline(inlineTok.children ?? []) : []
        if (inlineTok?.type === 'inline') cur.next()
        if (cur.peek()?.type === 'heading_close') cur.next()
        out.push({ t: 'heading', level, inline, raw })
        break
      }

      /* ---------------- 段落 ---------------- */
      case 'paragraph_open': {
        const raw = rawOf(tok, cur.lines)
        cur.next()
        const inlineTok = cur.peek()
        const inline = inlineTok?.type === 'inline' ? parseInline(inlineTok.children ?? []) : []
        if (inlineTok?.type === 'inline') cur.next()
        if (cur.peek()?.type === 'paragraph_close') cur.next()
        out.push({ t: 'p', inline, raw })
        break
      }

      /* ---------------- 列表 ---------------- */
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = tok.type === 'ordered_list_open'
        const startAttr = attrOf(tok, 'start')
        const raw = rawOf(tok, cur.lines)
        const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close'
        cur.next()

        const items: Block[][] = []
        while (cur.i < cur.tokens.length) {
          const t = cur.peek()
          if (!t || t.type === closeType) break
          if (t.type === 'list_item_open') {
            cur.next()
            const itemBlocks = parseBlocks(cur, new Set(['list_item_close']))
            if (cur.peek()?.type === 'list_item_close') cur.next()
            items.push(itemBlocks)
          } else {
            cur.next()
          }
        }
        if (cur.peek()?.type === closeType) cur.next()

        const start = startAttr ? Number(startAttr) : undefined
        out.push({
          t: 'list',
          ordered,
          ...(start !== undefined && Number.isFinite(start) && start !== 1 ? { start } : {}),
          items,
          raw,
        })
        break
      }

      /* ---------------- 代码 ---------------- */
      case 'fence': {
        const info = tok.info.trim()
        const lang = info ? info.split(/\s+/)[0] : ''
        out.push({
          t: 'code',
          ...(lang ? { lang } : {}),
          text: tok.content.replace(/\n$/, ''),
          raw: rawOf(tok, cur.lines),
        })
        cur.next()
        break
      }

      case 'code_block': {
        out.push({ t: 'code', text: tok.content.replace(/\n$/, ''), raw: rawOf(tok, cur.lines) })
        cur.next()
        break
      }

      /* ---------------- 引用 ---------------- */
      case 'blockquote_open': {
        const raw = rawOf(tok, cur.lines)
        cur.next()
        const children = parseBlocks(cur, new Set(['blockquote_close']))
        if (cur.peek()?.type === 'blockquote_close') cur.next()
        out.push({ t: 'quote', children, raw })
        break
      }

      /* ---------------- 表格 ---------------- */
      case 'table_open': {
        const raw = rawOf(tok, cur.lines)
        cur.next()
        const align: Align[] = []
        const head: Inline[][] = []
        const rows: Inline[][][] = []
        let inHead = false
        let currentRow: Inline[][] | null = null

        while (cur.i < cur.tokens.length) {
          const t = cur.peek()
          if (!t || t.type === 'table_close') break

          switch (t.type) {
            case 'thead_open':
              inHead = true
              cur.next()
              break
            case 'thead_close':
              inHead = false
              cur.next()
              break
            case 'tbody_open':
            case 'tbody_close':
              cur.next()
              break
            case 'tr_open':
              currentRow = []
              cur.next()
              break
            case 'tr_close':
              if (currentRow) {
                if (inHead) head.push(...currentRow)
                else rows.push(currentRow)
              }
              currentRow = null
              cur.next()
              break
            case 'th_open': {
              const style = attrOf(t, 'style') ?? ''
              const m = /text-align:\s*(left|center|right)/i.exec(style)
              align.push(m ? (m[1].toLowerCase() === 'left' ? 'l' : m[1].toLowerCase() === 'center' ? 'c' : 'r') : null)
              cur.next()
              break
            }
            case 'td_open':
            case 'th_close':
            case 'td_close':
              cur.next()
              break
            case 'inline':
              if (currentRow) currentRow.push(parseInline(t.children ?? []))
              cur.next()
              break
            default:
              cur.next()
              break
          }
        }
        if (cur.peek()?.type === 'table_close') cur.next()

        out.push({ t: 'table', align, head, rows, raw })
        break
      }

      /* ---------------- 脚注 ---------------- */
      case 'footnote_block_open': {
        cur.next()
        while (cur.i < cur.tokens.length) {
          const t = cur.peek()
          if (!t || t.type === 'footnote_block_close') break
          if (t.type === 'footnote_open') {
            const id = String(t.meta?.id ?? '')
            const label = String(t.meta?.label ?? '')
            cur.next()
            const children = parseBlocks(cur, new Set(['footnote_close']))
            if (cur.peek()?.type === 'footnote_close') cur.next()
            out.push({ t: 'fn', id, ...(label ? { label } : {}), children, raw: '' })
          } else {
            cur.next()
          }
        }
        if (cur.peek()?.type === 'footnote_block_close') cur.next()
        break
      }

      /* ---------------- 分隔线 / 裸 HTML ---------------- */
      case 'hr':
        out.push({ t: 'hr', raw: rawOf(tok, cur.lines) })
        cur.next()
        break

      case 'html_block': {
        const clean = sanitizeHtml(tok.content)
        if (clean.trim()) out.push({ t: 'html', raw: clean })
        cur.next()
        break
      }

      /* ---------------- 顶层图片（独立成段的 ![alt](src)） ---------------- */
      case 'inline': {
        const inline = parseInline(tok.children ?? [])
        const raw = rawOf(tok, cur.lines)
        cur.next()
        // 若整段只有一个图片，提升为图片块，便于各平台单独处理
        if (inline.length === 1 && inline[0].t === 'img') {
          const img = inline[0]
          out.push({ t: 'img', src: img.src, alt: img.alt, ...(img.title ? { title: img.title } : {}), raw })
        } else if (inline.length > 0) {
          out.push({ t: 'p', inline, raw })
        }
        break
      }

      default:
        cur.next()
        break
    }
  }

  return out
}

/* ------------------------------------------------------------------ */
/* 对外入口                                                            */
/* ------------------------------------------------------------------ */

export interface ParseInput {
  source: string
  /** 文件名，用于 front matter 缺 title 时兜底 */
  fileName?: string
}

export function parseArticle({ source, fileName = '' }: ParseInput): Doc {
  const warnings: string[] = []

  const split = splitFrontMatter(source)
  if (!split.found) {
    warnings.push('没有检测到 front matter（--- 包裹的头部），已按纯正文处理')
  }

  const fm = parseFrontMatter(split.raw)
  warnings.push(...fm.warnings)

  const pre = preprocess(split.body)
  warnings.push(...pre.warnings)

  const lines = pre.src.split('\n')
  const env: FootnoteEnv = {}
  const tokens = md.parse(pre.src, env) as unknown as MdToken[]
  const blocks = parseBlocks(new Cursor(tokens, lines), new Set<string>())

  const orphans = env[ORPHAN_FN_KEY] ?? []
  if (orphans.length) {
    warnings.push(
      `有 ${orphans.length} 条脚注定义没有对应的引用（${orphans.map((l) => `[^${l}]`).join('、')}），已原样保留在文末 —— 若本意是正文注释，请检查引用是否写漏`,
    )
  }

  const bodyText = blocksToText(blocks)
  const fallbackTitle = fileName.replace(/\.md$/i, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')

  const built = buildMeta(fm.data, fallbackTitle, bodyText)
  warnings.push(...built.warnings)

  // H1 降级提示
  if (/^#\s+\S/m.test(pre.src)) {
    warnings.push('正文里的一级标题已统一降为二级 —— 避免与公众号/知乎的标题位冲突')
  }

  if (blocks.length === 0) {
    warnings.push('解析后正文为空，请检查文件内容')
  }

  return {
    meta: built.meta,
    blocks,
    rawMd: split.body,
    warnings,
  }
}

/**
 * 渲染「阅读预览」用的 HTML。
 *
 * 和转换器走同一套前置处理（去 front matter、iframe 降级、HTML 消毒），
 * 所以预览里看到的结构就是转换器看到的结构 —— 不会出现「预览挺好、粘出来变形」。
 *
 * 输出只用于站内预览，不进入剪贴板，所以这里允许 class（外层容器靠 class 上样式）。
 */
export function renderPreviewHtml(source: string): string {
  const split = splitFrontMatter(source)
  const pre = preprocess(split.body)
  const body = md.render(pre.src, {})
  return `<div class="md-preview">${sanitizeHtml(body, { keepClasses: true })}</div>`
}
