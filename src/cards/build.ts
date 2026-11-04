/**
 * 从文章自动生成卡片草稿
 *
 * 四张卡：封面 / 金句 / 要点 / 结尾。
 * 全部由文章内容推导，用户可以再逐张改文字 —— 目标是「打开就有能用的图」，
 * 而不是让用户从空白开始排版。
 */

import type { Doc } from '../core/ir'
import { inlineText } from '../core/ir'
import { blocksToText } from '../core/ir'
import { charCount, truncateByChars } from '../core/cjk'
import type { CardSpec } from './types'

export const DEFAULT_SITE_NAME = '胡拉图说'

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

export function buildCards(doc: Doc, themeId: string, siteName = DEFAULT_SITE_NAME): CardSpec[] {
  const date = formatDate(doc.meta.date)
  const kicker = doc.meta.categories[0] ?? doc.meta.tags[0] ?? '随笔'
  const quote = pickQuote(doc)
  const points = pickPoints(doc)

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
    {
      id: 'quote',
      layout: 'quote',
      title: quote.text,
      subtitle: quote.source ?? '—— 摘自本文',
      footer: siteName,
      date,
      themeId,
    },
  ]

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

  cards.push({
    id: 'end',
    layout: 'end',
    title: doc.meta.summary || '感谢阅读',
    subtitle: doc.meta.tags.length ? `#${doc.meta.tags.slice(0, 3).join('　#')}` : undefined,
    footer: siteName,
    date,
    themeId,
  })

  return cards
}
