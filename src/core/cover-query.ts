/**
 * 封面图的搜索词
 *
 * 这件事比看起来难，因为 Unsplash 的图库是英文索引的：
 * 用「研究生」搜出来是一堆毕业典礼，用「laptop desk」才对。
 *
 * 所以分两档：
 * - 没有 AI：拿 front matter 的 tags / 标题当搜索词。能用，但中文关键词
 *   命中率看运气 —— 界面上会把「建议改成英文」写在输入框旁边，不假装很好用。
 * - 有 AI：让模型把文章压成 3 组**英文视觉关键词**。关键在「视觉」二字：
 *   模型很容易给出 "personal growth" 这种抽象概念，Unsplash 上没有对应的照片。
 *   所以 prompt 里明确要求「能拍出来的具体东西」。
 *
 * 三条候选是刻意的：一次搜 3 张、给 3 组词，用户不用在「词」和「图」两个
 * 维度上同时做选择题。
 */

import type { Doc } from './ir'
import { inlineText } from './ir'
import { truncateByChars } from './cjk'
import { parseJsonLoose } from '../ai/schemas'
import type { AIProvider } from '../ai/provider'

/** 搜索词上限：Unsplash 对超长 query 的匹配会变差，60 字符够放下 3–5 个英文词 */
const MAX_QUERY = 60

/**
 * 清洗搜索词。
 *
 * 去掉的几类是实打实会影响结果的：
 * - `#`：Unsplash 会把它当字面量，搜「#生活」几乎无结果
 * - 引号 / 书名号：同上
 * - 连续空格和换行：query 里出现换行会让部分代理直接报 400
 */
export function cleanCoverQuery(raw: string): string {
  return raw
    .replace(/^#+/, '')
    .replace(/[「」『』《》""'']/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY)
}

/**
 * 从文章推默认搜索词。
 *
 * 顺序是有讲究的：tag 比标题更适合搜图 —— 标题里常有「为什么」「怎么」
 * 这类无法拍摄的词，而 tag 通常是名词。
 */
export function guessCoverQuery(doc: Doc): string {
  const tags = doc.meta.tags.map(cleanCoverQuery).filter(Boolean)
  if (tags.length > 0) return tags[0]
  const cats = doc.meta.categories.map(cleanCoverQuery).filter(Boolean)
  if (cats.length > 0) return cats[0]
  return cleanCoverQuery(doc.meta.title)
}

/** 本地能凑出来的候选（不花 AI 额度）：tag 优先，标题兜底 */
export function localQueryCandidates(doc: Doc, limit = 3): string[] {
  const pool = [
    ...doc.meta.tags,
    ...doc.meta.categories,
    doc.meta.title,
  ]
    .map(cleanCoverQuery)
    .filter((q) => q.length > 0)

  const seen = new Set<string>()
  const out: string[] = []
  for (const q of pool) {
    if (seen.has(q)) continue
    seen.add(q)
    out.push(q)
    if (out.length >= limit) break
  }
  return out
}

/* ------------------------------------------------------------------ */
/* AI 关键词                                                            */
/* ------------------------------------------------------------------ */

const QUERY_RULES = `你要为这篇文章挑一张 Unsplash 封面照片，任务是把文章变成 3 组英文图片搜索词。

硬要求：
- 每组 1–3 个英文单词，用空格分隔，全部小写。
- 必须是**能拍出来的具体东西**：物体、场景、光线、动作、材质。
  ✓ "laptop desk night" / "coffee notebook" / "empty road morning"
  ✗ "personal growth" / "efficiency" / "the future of work" —— 这些没有对应的照片
- 3 组之间角度要不同：一组拍「场景」，一组拍「物体」，一组拍「氛围或光影」。
- 不要出现抽象名词、品牌名、人名、地名（除非文章就是在讲那个地方）。
- 不要输出中文。

输出格式：{"queries": ["...", "...", "..."]}`

/** 给模型看的文章摘要：标题 + 标签 + 开头几百字就够判断配图方向 */
function articleBrief(doc: Doc): string {
  const body = doc.blocks
    .map((b) => {
      // heading 和 p 的正文在 inline 里，quote / fn 的才在 children 里
      if (b.t === 'heading' || b.t === 'p') return inlineText(b.inline)
      return ''
    })
    .filter(Boolean)
    .join('\n')
  const excerpt = truncateByChars(body, 900)

  const lines = [
    `标题：${doc.meta.title}`,
    doc.meta.tags.length ? `标签：${doc.meta.tags.join('、')}` : '',
    doc.meta.summary ? `摘要：${doc.meta.summary}` : '',
    '',
    '正文开头：',
    excerpt,
  ]
  return lines.filter((l) => l !== undefined && l !== '').join('\n')
}

/**
 * 让 AI 出 3 组英文搜索词。
 *
 * 失败一律返回空数组而不是抛错：想词只是「锦上添花」，没想出来用户
 * 照样可以自己填词搜图，不该因此看到一条红色错误。
 */
export async function suggestCoverQueries(
  doc: Doc,
  provider: AIProvider,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!provider.available()) return []

  let text = ''
  try {
    const result = await provider.complete({
      system: QUERY_RULES,
      user: articleBrief(doc),
      signal,
    })
    text = result.text
  } catch {
    return []
  }

  const parsed = parseJsonLoose(text)
  if (parsed.error || !parsed.value || typeof parsed.value !== 'object') return []

  const raw = (parsed.value as { queries?: unknown }).queries
  if (!Array.isArray(raw)) return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const q = cleanCoverQuery(item)
    // 中文词直接丢掉：这一路的目的就是拿英文词，混进中文说明模型没照做
    if (!q || /[\u4e00-\u9fa5]/.test(q)) continue
    if (seen.has(q)) continue
    seen.add(q)
    out.push(q)
    if (out.length >= 3) break
  }
  return out
}

/** 摘要里是否含有中文：用来决定要不要提示「建议改成英文」 */
export function looksChinese(text: string): boolean {
  return /[\u4e00-\u9fa5]/.test(text)
}

/** 搜索结果为空时的兜底建议：多数情况是词太抽象或太中文 */
export function emptyHint(query: string): string {
  if (looksChinese(query)) {
    return `「${query}」是中文词，Unsplash 的图库是英文索引的，命中率很低。换成英文试试，比如 laptop / desk / city。`
  }
  if (query.trim().split(/\s+/).length > 4) {
    return '词太多了。Unsplash 是「关键词」匹配，缩到 1–3 个词更容易命中。'
  }
  return '这个词没搜到图。换个更具体的实物词试试，比如 coffee、window、bicycle。'
}
