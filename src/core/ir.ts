/**
 * 中间表示（IR）
 *
 * 设计要点：
 * 1. 必须有 inline 层 —— 博客里 `**加粗**` 有 864 处、行内代码 38 处、外链 131 个，
 *    段落若只存纯文本会全部丢失。
 * 2. 每个 block 保留 `raw`（原始 Markdown 片段）—— 既是信息兜底，也是
 *    「复制 Markdown」出口的直接来源。
 * 3. `list.items` 是 `Block[][]`，一次解决「列表项内含多段落 / 嵌套列表 / 项内代码块」。
 * 4. heading.level 只允许 2/3/4 —— H1 统一降为 H2，正文 H1 不能去抢公众号/知乎的标题位。
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'img'; src: string; alt: string; title?: string }
  | { t: 'br' }
  | { t: 'fnref'; id: string }
  | { t: 'html'; raw: string }

export type Align = 'l' | 'c' | 'r' | null

export type Block =
  | { t: 'heading'; level: 2 | 3 | 4; inline: Inline[]; raw: string }
  | { t: 'p'; inline: Inline[]; raw: string }
  | { t: 'list'; ordered: boolean; start?: number; items: Block[][]; raw: string }
  | { t: 'code'; lang?: string; text: string; raw: string }
  | { t: 'img'; src: string; alt: string; title?: string; raw: string }
  | { t: 'quote'; children: Block[]; raw: string }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][]; raw: string }
  | { t: 'fn'; id: string; label?: string; children: Block[]; raw: string }
  | { t: 'hr'; raw: string }
  | { t: 'html'; raw: string }

export interface DocMeta {
  title: string
  categories: string[]
  tags: string[]
  date?: string
  summary: string
  description: string
  slug?: string
  series?: string[]
  draft?: boolean
  /** front matter 里其它未被显式建模的字段，原样保留 */
  extra: Record<string, string | string[] | boolean>
}

export interface Doc {
  meta: DocMeta
  blocks: Block[]
  /** 去掉 front matter 后的原始正文 Markdown */
  rawMd: string
  warnings: string[]
}

/* ------------------------------------------------------------------ */
/* 遍历与提取工具                                                       */
/* ------------------------------------------------------------------ */

/** 把一个 inline 节点序列拍平成纯文本 */
export function inlineText(nodes: Inline[]): string {
  let out = ''
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        out += n.v
        break
      case 'code':
        out += n.v
        break
      case 'strong':
      case 'em':
      case 'del':
      case 'link':
        out += inlineText(n.c)
        break
      case 'img':
        out += n.alt
        break
      case 'br':
        out += '\n'
        break
      case 'fnref':
        break
      case 'html':
        out += n.raw.replace(/<[^>]+>/g, '')
        break
    }
  }
  return out
}

/** 深度遍历所有 inline 节点 */
export function walkInlines(nodes: Inline[], fn: (n: Inline) => void): void {
  for (const n of nodes) {
    fn(n)
    if (n.t === 'strong' || n.t === 'em' || n.t === 'del' || n.t === 'link') {
      walkInlines(n.c, fn)
    }
  }
}

/** 深度遍历所有 block（含嵌套的 quote / list / fn） */
export function walkBlocks(blocks: Block[], fn: (b: Block) => void): void {
  for (const b of blocks) {
    fn(b)
    if (b.t === 'quote') walkBlocks(b.children, fn)
    else if (b.t === 'list') for (const item of b.items) walkBlocks(item, fn)
    else if (b.t === 'fn') walkBlocks(b.children, fn)
  }
}

export interface ImageRef {
  src: string
  alt: string
  /** 该图片所在块的序号，便于在预览里定位 */
  blockIndex: number
}

/** 收集全文所有图片（含行内图片、独立图片块、列表项内、引用块与脚注内） */
export function collectImages(blocks: Block[]): ImageRef[] {
  const out: ImageRef[] = []
  const seen = new Set<string>()

  // 同一张图在文中重复出现只记一次 —— 「待上传清单」只需要唯一 URL
  const add = (src: string, alt: string, blockIndex: number) => {
    if (!src || seen.has(src)) return
    seen.add(src)
    out.push({ src, alt, blockIndex })
  }

  const scanInline = (arr: Inline[], blockIndex: number) => {
    walkInlines(arr, (n) => {
      if (n.t === 'img') add(n.src, n.alt, blockIndex)
    })
  }

  const walk = (list: Block[]) => {
    list.forEach((b, idx) => {
      switch (b.t) {
        case 'img':
          add(b.src, b.alt, idx)
          break
        case 'p':
        case 'heading':
          scanInline(b.inline, idx)
          break
        case 'table':
          for (const cell of b.head) scanInline(cell, idx)
          for (const row of b.rows) for (const cell of row) scanInline(cell, idx)
          break
        case 'quote':
        case 'fn':
          walk(b.children)
          break
        case 'list':
          for (const item of b.items) walk(item)
          break
        default:
          break
      }
    })
  }

  walk(blocks)
  return out
}

export interface LinkRef {
  href: string
  text: string
}

/** 收集全文所有外链（去重，保持出现顺序） */
export function collectLinks(blocks: Block[]): LinkRef[] {
  const seen = new Set<string>()
  const out: LinkRef[] = []
  const consider = (arr: Inline[]) => {
    walkInlines(arr, (n) => {
      if (n.t === 'link' && n.href && !seen.has(n.href)) {
        seen.add(n.href)
        out.push({ href: n.href, text: inlineText(n.c) || n.href })
      }
    })
  }
  walkBlocks(blocks, (b) => {
    if (b.t === 'p' || b.t === 'heading') consider(b.inline)
    else if (b.t === 'table') {
      for (const cell of b.head) consider(cell)
      for (const row of b.rows) for (const cell of row) consider(cell)
    }
  })
  return out
}

/** 全文纯文本 */
export function blocksToText(blocks: Block[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    switch (b.t) {
      case 'heading':
        parts.push(inlineText(b.inline))
        break
      case 'p':
        parts.push(inlineText(b.inline))
        break
      case 'quote':
        parts.push(blocksToText(b.children))
        break
      case 'list':
        parts.push(
          b.items
            .map((item) =>
              item
                .map((x) => (x.t === 'p' ? inlineText(x.inline) : blocksToText([x])))
                .join('\n'),
            )
            .join('\n'),
        )
        break
      case 'code':
        parts.push(b.text)
        break
      case 'img':
        parts.push(b.alt)
        break
      case 'table':
        parts.push(
          [b.head, ...b.rows].map((row) => row.map((c) => inlineText(c)).join(' | ')).join('\n'),
        )
        break
      case 'fn':
        parts.push(blocksToText(b.children))
        break
      default:
        break
    }
  }
  return parts.filter(Boolean).join('\n\n')
}
