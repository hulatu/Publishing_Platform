/**
 * 章节切分
 *
 * 这是「章节摘要 → 平台组装」流水线的第一步，也是整个改写质量的地基。
 *
 * 为什么不再把整篇文章当一坨文本喂给模型：
 * 1. 覆盖不全 —— 模型会盯着开头几段写，后半篇的内容直接丢
 * 2. 要点散乱 —— 没有结构锚点，出来的「要点」是模型的自由发挥
 * 3. 无法核对 —— 用户看不出哪句话对应原文哪一段
 *
 * 按 ## 切开后，每个小节单独压成 1–2 句，再拿这些句子去组装各平台文案：
 * 覆盖完整、可逐条核对、且小红书/推特要的「要点列表」天然就有了。
 */

import type { Block, Doc } from './ir'
import { blocksToText } from './ir'
import { charCount, truncateByChars } from './cjk'

export interface ArticleSection {
  /** 1 起 */
  index: number
  /** ## 标题原文；第一个 ## 之前的内容叫「开篇」；无 ## 时按段落分组 */
  heading: string
  /** 该节正文纯文本（未截断） */
  bodyText: string
  chars: number
  /** 该节是否由多个小节合并而来（合并时 heading 取第一个） */
  merged?: boolean
}

export interface SplitSectionsOptions {
  /** 最多保留多少节；超出时合并相邻最小的。默认 12 */
  maxSections?: number
  /** 正文短于这个字数的小节并入上一节（纯分隔用的标题）。默认 50 */
  minSectionChars?: number
}

const OPENING_HEADING = '开篇'

/**
 * 去掉 Hugo 的自定义锚点写法 `## 标题 {#anchor}`。
 * markdown-it 不会吃掉这段，它会原样留在标题文本里，
 * 带进摘要就是「概括 {#gai-kuo」这种脏数据。
 */
export function stripHeadingAnchor(text: string): string {
  return text.replace(/\s*\{#[^}]*\}/g, '').trim()
}

/** 从 blocks 里取出纯文本，但保留列表项的换行，便于后续抽句 */
function blocksText(blocks: Block[]): string {
  return stripHeadingAnchor(blocksToText(blocks).trim())
}

/** 把没有 ## 的文章按段落切成若干块 */
function chunkByParagraphs(doc: Doc, target: number): ArticleSection[] {
  const paragraphs = doc.blocks.filter((b) => b.t === 'p')
  if (paragraphs.length === 0) {
    const all = blocksText(doc.blocks)
    return all
      ? [{ index: 1, heading: doc.meta.title || '全文', bodyText: all, chars: charCount(all) }]
      : []
  }

  const groups: Block[][] = []
  let current: Block[] = []
  let currentChars = 0

  for (const b of doc.blocks) {
    if (b.t === 'heading' && b.level === 2) continue
    current.push(b)
    currentChars += charCount(blocksText([b]))
    if (currentChars >= target) {
      groups.push(current)
      current = []
      currentChars = 0
    }
  }
  if (current.length) groups.push(current)

  return groups.map((g, i) => {
    const text = blocksText(g)
    return {
      index: i + 1,
      heading: `第 ${i + 1} 部分`,
      bodyText: text,
      chars: charCount(text),
    }
  })
}

/**
 * 按 ## 切分小节。
 * 处理三种情况：
 * - 正常：有多个 ##
 * - 只有开篇内容（无 ##）：按段落分组
 * - 有小节但正文过短（纯分隔标题）：并入上一节
 */
export function splitSections(doc: Doc, opts: SplitSectionsOptions = {}): ArticleSection[] {
  const maxSections = opts.maxSections ?? 12
  const minChars = opts.minSectionChars ?? 50

  const hasH2 = doc.blocks.some((b) => b.t === 'heading' && b.level === 2)
  if (!hasH2) {
    const chunks = chunkByParagraphs(doc, 700)
    return mergeToCap(chunks, maxSections)
  }

  // 按 H2 分桶
  const raw: { heading: string; blocks: Block[] }[] = []
  let current: { heading: string; blocks: Block[] } | null = null

  for (const b of doc.blocks) {
    if (b.t === 'heading' && b.level === 2) {
      if (current) raw.push(current)
      const heading = blocksText([b]).trim() || `第 ${raw.length + 1} 节`
      current = { heading, blocks: [] }
      continue
    }
    if (!current) {
      current = { heading: OPENING_HEADING, blocks: [] }
    }
    current.blocks.push(b)
  }
  if (current) raw.push(current)

  // 转成 section，同时把过短的并进上一节
  const sections: ArticleSection[] = []
  for (const item of raw) {
    const text = blocksText(item.blocks)
    const chars = charCount(text)

    if (sections.length > 0 && chars < minChars) {
      const prev = sections[sections.length - 1]
      prev.bodyText = `${prev.bodyText}\n\n${item.heading}\n${text}`.trim()
      prev.chars = charCount(prev.bodyText)
      prev.merged = true
      continue
    }

    // 开篇内容为空时不要占一节
    if (item.heading === OPENING_HEADING && chars === 0) continue

    sections.push({
      index: sections.length + 1,
      heading: item.heading,
      bodyText: text,
      chars,
    })
  }

  return mergeToCap(sections, maxSections)
}

/** 超出上限时，反复合并相邻两个总字数最小的小节，直到符合上限 */
function mergeToCap(sections: ArticleSection[], cap: number): ArticleSection[] {
  const list = sections.map((s) => ({ ...s }))
  while (list.length > cap) {
    let bestIdx = 0
    let bestCost = Infinity
    for (let i = 0; i < list.length - 1; i++) {
      const cost = list[i].chars + list[i + 1].chars
      if (cost < bestCost) {
        bestCost = cost
        bestIdx = i
      }
    }
    const a = list[bestIdx]
    const b = list[bestIdx + 1]
    a.bodyText = `${a.bodyText}\n\n${b.heading}\n${b.bodyText}`.trim()
    a.chars = charCount(a.bodyText)
    a.merged = true
    list.splice(bestIdx + 1, 1)
  }
  return list.map((s, i) => ({ ...s, index: i + 1 }))
}

/** 给模型看的节选文本：控制单节长度，避免长节吃掉整个上下文预算 */
export function sectionTextForPrompt(section: ArticleSection, limit = 1400): string {
  return truncateByChars(section.bodyText, limit, '…（本节后文省略）')
}

/** 整篇文章送给模型的节选总预算（字符） */
export const SECTION_PROMPT_BUDGET = 14000

/**
 * 按预算分配每节的截断长度：短节不截，长节多给，总和不超过预算。
 */
export function allocateSectionBudget(sections: ArticleSection[], budget = SECTION_PROMPT_BUDGET): number[] {
  const total = sections.reduce((n, s) => n + s.chars, 0)
  if (total <= budget) return sections.map((s) => s.chars)

  // 先给每节保底 400 字，剩余按比例分配
  const floor = 400
  const fixed = sections.map((s) => Math.min(s.chars, floor))
  const used = fixed.reduce((a, b) => a + b, 0)
  const rest = Math.max(0, budget - used)
  const remainingChars = sections.map((s, i) => Math.max(0, s.chars - fixed[i]))
  const remainingTotal = remainingChars.reduce((a, b) => a + b, 0) || 1

  return sections.map((_s, i) => {
    if (remainingChars[i] === 0) return fixed[i]
    return fixed[i] + Math.floor((remainingChars[i] / remainingTotal) * rest)
  })
}
