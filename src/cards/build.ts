/**
 * 从文章自动生成卡片草稿
 *
 * 默认一套图 = 封面 + 每个 ## 小节一张 + 结尾。
 * 之所以按小节出图，是因为小红书/公众号的图集需要「一图一件事」：
 * 一张图塞四个要点，读者在手机上一眼扫过去什么都记不住；一节一张，
 * 每张只讲一件事，图集本身就成了一份可以滑完的提纲。
 *
 * 小节卡的正文优先用 AI 生成的章节摘要（用户已经在摘要面板里校对过），
 * 没有摘要时退到「本节前两句」，保证打开就有能用的图。
 */

import type { Doc } from '../core/ir'
import { blocksToText, inlineText } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import { charCount, splitSentences, truncateByChars } from '../core/cjk'
import type { CardLayout, CardSpec, CardStat } from './types'

export const DEFAULT_SITE_NAME = '胡拉图说'

/** 小节摘要的上限：540×720 的卡面放得下约 5 行，再多就要缩字号 */
const SECTION_SUMMARY_MAX = 118

export interface SectionSummary {
  index: number
  summary: string
}

export interface BuildCardsOptions {
  doc: Doc
  themeId: string
  siteName?: string
  /** splitSections() 的结果；为空时退回「金句 + 要点」的老组合 */
  sections?: ArticleSection[]
  /** AI 生成的章节摘要，按 index 对齐；可为空 */
  summaries?: SectionSummary[] | null
}

function formatDate(raw?: string): string {
  if (!raw) {
    const d = new Date()
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (m) return `${m[1]}.${m[2]}.${m[3]}`
  return raw.slice(0, 10)
}

/** 挑一句最适合做金句的话：优先引用块，其次含加粗的段落，最后退到开篇 */
function pickQuote(doc: Doc): { text: string; source?: string } {
  // 1. 引用块
  for (const b of doc.blocks) {
    if (b.t === 'quote') {
      const text = blocksToText(b.children).trim().replace(/\s+/g, ' ')
      if (charCount(text) >= 8 && charCount(text) <= 120) {
        return { text }
      }
    }
  }

  // 2. 含加粗关键词的段落里，取加粗部分最像「结论」的那句
  const candidates: { text: string; score: number }[] = []
  for (const b of doc.blocks) {
    if (b.t !== 'p') continue
    const strongs = b.inline.filter((n) => n.t === 'strong').map((n) => (n.t === 'strong' ? inlineText(n.c) : ''))
    const full = inlineText(b.inline).trim()
    if (strongs.length === 0) continue

    // 优先取加粗短语本身（通常就是提炼好的观点）
    const short = strongs.filter((s) => charCount(s) >= 6 && charCount(s) <= 40)
    if (short.length) {
      candidates.push({ text: short[0], score: 10 - Math.min(short[0].length / 20, 3) })
    }
    if (charCount(full) >= 10 && charCount(full) <= 100) {
      candidates.push({ text: full, score: 6 })
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score)
    return { text: candidates[0].text }
  }

  // 3. 开篇第一段
  for (const b of doc.blocks) {
    if (b.t === 'p') {
      const text = inlineText(b.inline).trim()
      if (charCount(text) >= 8) return { text: truncateByChars(text, 100) }
    }
  }

  return { text: doc.meta.summary || doc.meta.title }
}

/** 提炼 3–5 条要点：优先列表项，其次三级标题，最后退到高分段落 */
function pickPoints(doc: Doc): string[] {
  const fromList: string[] = []
  for (const b of doc.blocks) {
    if (b.t === 'list') {
      for (const item of b.items) {
        const text = item
          .map((x) => (x.t === 'p' ? inlineText(x.inline) : ''))
          .filter(Boolean)
          .join(' ')
          .trim()
        if (text && charCount(text) <= 60) fromList.push(text)
      }
    }
  }
  if (fromList.length >= 3) return fromList.slice(0, 5)

  const fromHeading: string[] = []
  for (const b of doc.blocks) {
    if (b.t === 'heading' && b.level === 3) {
      const text = inlineText(b.inline).trim()
      if (text) fromHeading.push(text)
    }
  }
  if (fromHeading.length >= 3) return fromHeading.slice(0, 5)

  // 退到二级标题
  const fromH2: string[] = []
  for (const b of doc.blocks) {
    if (b.t === 'heading' && b.level === 2) {
      const text = inlineText(b.inline).trim()
      if (text) fromH2.push(text)
    }
  }
  if (fromH2.length >= 3) return fromH2.slice(0, 5)

  // 最后：取含加粗的段落首句
  const fromPara: string[] = []
  for (const b of doc.blocks) {
    if (b.t !== 'p') continue
    if (!b.inline.some((n) => n.t === 'strong')) continue
    const text = inlineText(b.inline).trim()
    if (charCount(text) >= 10) fromPara.push(truncateByChars(text, 48))
    if (fromPara.length >= 5) break
  }

  return [...fromList, ...fromHeading, ...fromH2, ...fromPara].slice(0, 5)
}

/** 没有 AI 摘要时的兜底：本节前两句，凑不满就截断 */
function localSummary(section: ArticleSection): string {
  // proseText 已经剔掉标题，避免「科研 作为一个工科研究生……」这种标题粘正文
  const text = (section.proseText || section.bodyText).replace(/\s+/g, ' ').trim()
  if (!text) return ''

  let out = ''
  for (const s of splitSentences(text)) {
    if (charCount(out + s) > SECTION_SUMMARY_MAX) break
    out += s
  }
  return out || truncateByChars(text, SECTION_SUMMARY_MAX)
}

function summaryOf(section: ArticleSection, summaries?: SectionSummary[] | null): string {
  const hit = summaries?.find((s) => s.index === section.index)?.summary?.trim()
  // AI 摘要偶尔会短得没信息量，太短的仍然走本地兜底
  if (hit && charCount(hit) >= 12) return truncateByChars(hit, SECTION_SUMMARY_MAX)
  return localSummary(section)
}

/* ------------------------------------------------------------------ */

/**
 * 从正文里捞带单位的数字做数据卡。
 *
 * 只认「数字 + 单位」这种明确写法（98%、3.2 倍、12 万），不认光秃秃的年份 ——
 * 把「2026」当成指标是这类自动提炼最典型的翻车方式。
 */
const NUMBER_UNIT =
  /(\d+(?:\.\d+)?\s*(?:%|倍|万|亿|年|个月|小时|分钟|天|周|篇|人|次|元|美元|公里|km|GB|MB|字))/

function pickStats(doc: Doc): CardStat[] {
  const out: CardStat[] = []
  const seen = new Set<string>()

  const scan = (text: string) => {
    if (out.length >= 3) return
    const hit = NUMBER_UNIT.exec(text)
    if (!hit) return
    const value = hit[1].replace(/\s+/g, '')
    // 年份不是指标：「2025 年」几乎每篇都有，抓进来只会挤掉真正的数据
    if (/^(?:19|20)\d{2}年$/.test(value)) return
    if (seen.has(value)) return
    seen.add(value)

    // 说明取「数字所在的那一个短句」，去掉数字本身；
    // 整段截 26 字会把前后两件事粘在一起，读起来像半句话
    const clause = text.split(/[，。；！？,;]/).find((s) => s.includes(hit[0])) ?? text
    const label = truncateByChars(clause.replace(hit[0], '').replace(/^[、：:。\s]+/, '').trim(), 22)
    out.push({ value, label: label || '来自本文' })
  }

  for (const b of doc.blocks) {
    if (out.length >= 3) break
    if (b.t === 'p') scan(inlineText(b.inline))
    else if (b.t === 'heading') scan(inlineText(b.inline))
    else if (b.t === 'list') {
      for (const item of b.items) {
        const text = item
          .map((x) => (x.t === 'p' ? inlineText(x.inline) : ''))
          .filter(Boolean)
          .join(' ')
        if (text) scan(text)
      }
    }
  }

  return out
}

/** 目录卡的条目：优先二级标题，不够再用三级标题，最多 6 条 */
function pickChapters(doc: Doc, sections?: ArticleSection[]): string[] {
  if (sections && sections.length >= 2) return sections.map((s) => s.heading).filter(Boolean).slice(0, 6)

  const ofLevel = (level: 2 | 3) =>
    doc.blocks
      .filter((b) => b.t === 'heading' && b.level === level)
      .map((b) => (b.t === 'heading' ? inlineText(b.inline).trim() : ''))
      .filter(Boolean)

  const h2 = ofLevel(2)
  if (h2.length >= 2) return h2.slice(0, 6)
  return (h2.length ? h2 : ofLevel(3)).slice(0, 6)
}

/** 造一张卡（「加一张卡」菜单也用它） */
export function makeCard(
  doc: Doc,
  layout: CardLayout,
  themeId: string,
  siteName = DEFAULT_SITE_NAME,
  sections?: ArticleSection[],
): CardSpec {
  const date = formatDate(doc.meta.date)
  const kicker = doc.meta.categories[0] ?? doc.meta.tags[0] ?? '随笔'
  const base = { footer: siteName, date, themeId, kicker }

  switch (layout) {
    case 'cover':
      return {
        id: `cover-${Date.now()}`,
        layout,
        title: doc.meta.title,
        subtitle: doc.meta.summary || undefined,
        ...base,
      }
    case 'quote': {
      const quote = pickQuote(doc)
      return {
        id: `quote-${Date.now()}`,
        layout,
        title: quote.text,
        subtitle: quote.source ?? '—— 摘自本文',
        ...base,
      }
    }
    case 'points':
      return {
        id: `points-${Date.now()}`,
        layout,
        title: '这篇文章讲了什么',
        points: pickPoints(doc),
        ...base,
      }
    case 'section':
      return {
        id: `section-${Date.now()}`,
        layout,
        title: '在这里写一个小节标题',
        subtitle: '再补一两句话说明这一节讲了什么。',
        ...base,
      }
    case 'stat':
      return {
        id: `stat-${Date.now()}`,
        layout,
        title: '几个值得记住的数字',
        stats: pickStats(doc),
        ...base,
      }
    case 'toc':
      return {
        id: `toc-${Date.now()}`,
        layout,
        title: '这一篇讲了什么',
        points: pickChapters(doc, sections),
        ...base,
      }
    case 'compare':
      return {
        id: `compare-${Date.now()}`,
        layout,
        title: '两种做法',
        leftLabel: '做法 A',
        rightLabel: '做法 B',
        points: ['先写结构 | 先写开头', '最后统一改字句 | 边写边改'],
        ...base,
      }
    case 'cta':
      return {
        id: `cta-${Date.now()}`,
        layout,
        title: `关注「${siteName}」`,
        subtitle: '不错过每一篇长文',
        points: ['长按识别 · 关注'],
        ...base,
      }
    case 'end':
      return {
        id: `end-${Date.now()}`,
        layout,
        title: doc.meta.summary || '感谢阅读',
        subtitle: doc.meta.tags.length ? `#${doc.meta.tags.slice(0, 3).join('　#')}` : undefined,
        ...base,
      }
  }
}

/** 按「封面 → 每节一张 → 结尾」生成整套图，并统一注入页码 */
export function buildCards(opts: BuildCardsOptions): CardSpec[] {
  const { doc, themeId, siteName = DEFAULT_SITE_NAME, sections = [], summaries } = opts
  const date = formatDate(doc.meta.date)
  const kicker = doc.meta.categories[0] ?? doc.meta.tags[0] ?? '随笔'

  const cards: CardSpec[] = [
    {
      id: 'cover',
      layout: 'cover',
      title: doc.meta.title,
      subtitle: doc.meta.summary || undefined,
      kicker,
      footer: siteName,
      date,
      themeId,
    },
  ]

  if (sections.length > 0) {
    for (const s of sections) {
      cards.push({
        id: `section-${s.index}`,
        layout: 'section',
        title: s.heading,
        subtitle: summaryOf(s, summaries),
        kicker,
        footer: siteName,
        date,
        themeId,
      })
    }
  } else {
    // 切不出小节（极短的文章）：退回金句 + 要点
    const quote = pickQuote(doc)
    cards.push({
      id: 'quote',
      layout: 'quote',
      title: quote.text,
      subtitle: quote.source ?? '—— 摘自本文',
      kicker,
      footer: siteName,
      date,
      themeId,
    })

    const points = pickPoints(doc)
    if (points.length >= 2) {
      cards.push({
        id: 'points',
        layout: 'points',
        title: '这篇文章讲了什么',
        points,
        kicker: '要点',
        footer: siteName,
        date,
        themeId,
      })
    }
  }

  cards.push({
    id: 'end',
    layout: 'end',
    title: doc.meta.summary || '感谢阅读',
    subtitle: doc.meta.tags.length ? `#${doc.meta.tags.slice(0, 3).join('　#')}` : undefined,
    kicker: '结语',
    footer: siteName,
    date,
    themeId,
  })

  // 页码：01 / 08 —— 图集连起来读时知道自己在第几张
  const total = cards.length
  const pad = (n: number) => String(n).padStart(2, '0')
  return cards.map((c, i) => ({ ...c, mark: `${pad(i + 1)} / ${pad(total)}` }))
}
