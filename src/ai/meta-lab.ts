/**
 * 标题候选与标签推荐
 *
 * 为什么单独一路而不是塞进平台文案里：
 * 标题是「一篇内容对多个平台」共用的资产 —— 公众号要长、小红书必须 ≤20 字、
 * 知乎吃信息量、微博吃情绪。让模型在写小红书正文时顺带起标题，它只会给一个
 * 刚好塞进 20 字的短句，公众号那边就没得选了。所以标题单独生成一批、8 个角度，
 * 用户按平台挑。
 *
 * 校验的取舍和违禁词表一致：宁可少一条，不要吵。
 * 「至少 3 条 ≤20 字」是硬约束（小红书用得上），其余是软约束（角度不重复、
 * 不许编数字）。角度重复不判失败 —— 模型经常把 statement 和 judgement 混着用，
 * 为此重试一次不值当。
 */

import type { Doc } from '../core/ir'
import { inlineText } from '../core/ir'
import type { ArticleSection } from '../core/sections'
import { charCount, countEmoji, findBlacklisted, truncateByChars } from '../core/cjk'
import { shortLabel } from './fallback'
import { PERSONA } from './prompts'
import { parseJsonLoose } from './schemas'
import { describeAIError, resolveProvider } from './provider'
import { runJson } from './pipeline'
import {
  emptyMetaLabState,
  LIMITS,
  titleStyleLabels,
  type DigestSet,
  type MetaLabSet,
  type MetaLabState,
  type TagSuggestion,
  type TitleCandidate,
  type TitleStyle,
} from './types'

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

export const META_LAB_RULES = `你要给这篇文章出 8 个标题候选，外加一组平台标签。

标题的硬要求：
- 一共 8 条，每条不超过 40 字，其中至少 3 条不超过 20 字。
  （小红书标题上限就是 20 字，短的那几条必须能直接拿去用，不要只是长标题截一半。）
- 8 条角度必须不同，不许同一句话换词序。角度从下面六类里挑，每类最多 2 条：
  statement 陈述：说清这篇文章做了什么、得到什么结论
  number 数字：把原文里真实存在的数字提到标题里；原文没有数字就不要硬造
  question 疑问：提出读者真会有的疑问，且正文确实能回答
  contrast 对比：把两个对照面放在一起（前后、取舍、新旧）
  howto 做法：讲方法与过程，不承诺结果
  judgement 判断：一句明确的个人判断，有立场但不夸张
- 每条配一个 style 字段，取上面六个英文词之一。
- 只能用原文出现过的事实、数字、书名、人名、产品名。原文没有的绝不编。
- 不要标题党：不用「震惊」「必看」「99% 的人不知道」「看完这篇就够了」，
  不用感叹号结尾，不用 emoji。
- 保留「」作为引号，标点用全角。

标签：
- 给 ${LIMITS.tagCount} 个，每个 2–8 字，不带 # 号，不带空格，不要解释性长句。
- 覆盖三层：大词（领域/类目，别人会搜的）、具体词（这篇特有的对象、方法、产品）、
  平台常用词（小红书、微博话题里常见的那类）。
- 优先复用原文 front matter 里的分类与标签，但不要堆一堆同义词。`

const META_LAB_SHAPE = `输出 JSON（字段名必须完全一致）：
{
  "titles": [
    { "text": "标题正文", "style": "statement" }
  ],
  "tags": [
    { "name": "标签" }
  ]
}`

export interface MetaLabPrompt {
  system: string
  user: string
}

export function buildMetaLabPrompt(doc: Doc, digest: DigestSet | null, sections: ArticleSection[]): MetaLabPrompt {
  const headings = sections.map((s) => `${s.index}. ${s.heading}`).join('\n')
  const points = digest?.sections.map((s) => `${s.index}. ${s.heading}：${s.summary}`).join('\n') ?? ''

  const metaLines = [
    `原标题：${doc.meta.title}`,
    doc.meta.categories.length ? `分类：${doc.meta.categories.join('、')}` : '',
    doc.meta.tags.length ? `标签：${doc.meta.tags.join('、')}` : '',
    doc.meta.summary ? `作者自写摘要：${doc.meta.summary}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const user = `${META_LAB_RULES}

${META_LAB_SHAPE}

---
${metaLines}

小节结构（共 ${sections.length} 节）：
${headings}
${points ? `\n逐节要点：\n${points}` : ''}
${digest?.oneLiner ? `\n全篇一句话：${digest.oneLiner}` : ''}
---`

  return { system: PERSONA, user }
}

/* ------------------------------------------------------------------ */
/* 解析 / 规范化                                                        */
/* ------------------------------------------------------------------ */

const STYLE_SET = new Set<TitleStyle>(['statement', 'number', 'question', 'contrast', 'howto', 'judgement'])

const STYLE_ALIAS: Record<string, TitleStyle> = {
  陈述: 'statement',
  数字: 'number',
  疑问: 'question',
  对比: 'contrast',
  做法: 'howto',
  判断: 'judgement',
  statement: 'statement',
  number: 'number',
  question: 'question',
  contrast: 'contrast',
  howto: 'howto',
  judgement: 'judgement',
}

/** 模型没给 style（或给了没见过的词）时，按文本特征猜一个，别让整条丢掉 */
export function guessStyle(text: string): TitleStyle {
  if (/[？?]\s*$/.test(text)) return 'question'
  if (/\d/.test(text)) return 'number'
  if (/^(怎么|如何|怎样|为什么|凭什么)/.test(text)) return 'howto'
  if (/(不是|而是|之前|之后|以前|现在)/.test(text)) return 'contrast'
  if (/(我|觉得|认为|应该|其实)/.test(text)) return 'judgement'
  return 'statement'
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^[\s"'「『]+/, '')
    .replace(/[\s"'」』]+$/, '')
    .replace(/[!！]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanTag(raw: string): string {
  return raw
    .replace(/^#+/, '')
    .replace(/#+$/, '')
    .replace(/[\s#，,。、]+/g, '')
    .trim()
}

/** 去重用的归一化键：忽略空白与标点，避免「写作流程」和「写作 流程」算两条 */
function dedupeKey(s: string): string {
  return s.replace(/[\s，,。.、：:；;！!？?「」『』"'—\-·]/g, '')
}

export function normalizeMetaLab(input: unknown): MetaLabSet {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  const rawTitles = Array.isArray(obj.titles) ? obj.titles : Array.isArray(obj['标题']) ? obj['标题'] : []
  const rawTags = Array.isArray(obj.tags) ? obj.tags : Array.isArray(obj['标签']) ? obj['标签'] : []

  const titles: TitleCandidate[] = []
  for (const item of rawTitles) {
    if (typeof item === 'string') {
      const text = cleanTitle(item)
      if (text) titles.push({ text, style: guessStyle(text) })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const text = cleanTitle(typeof o.text === 'string' ? o.text : typeof o.title === 'string' ? o.title : '')
    if (!text) continue
    const styleRaw = String(o.style ?? o.angle ?? o['角度'] ?? '').trim().toLowerCase()
    const style = STYLE_SET.has(styleRaw as TitleStyle)
      ? (styleRaw as TitleStyle)
      : (STYLE_ALIAS[styleRaw] ?? guessStyle(text))
    const note = typeof o.note === 'string' ? o.note.trim() : undefined
    titles.push({ text, style, note })
  }

  const tags: TagSuggestion[] = []
  for (const item of rawTags) {
    if (typeof item === 'string') {
      const name = cleanTag(item)
      if (name) tags.push({ name })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = cleanTag(typeof o.name === 'string' ? o.name : typeof o.tag === 'string' ? o.tag : '')
    if (!name) continue
    tags.push({ name, why: typeof o.why === 'string' ? o.why.trim() : undefined })
  }

  return { titles: dedupeTitles(titles), tags: dedupeTags(tags) }
}

function dedupeTitles(list: TitleCandidate[]): TitleCandidate[] {
  const seen = new Set<string>()
  const out: TitleCandidate[] = []
  for (const t of list) {
    const k = dedupeKey(t.text)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

function dedupeTags(list: TagSuggestion[]): TagSuggestion[] {
  const seen = new Set<string>()
  const out: TagSuggestion[] = []
  for (const t of list) {
    const k = dedupeKey(t.name)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(t)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 校验                                                                */
/* ------------------------------------------------------------------ */

export function shortCount(set: MetaLabSet): number {
  return set.titles.filter((t) => charCount(t.text) <= LIMITS.titleShort).length
}

export function validateMetaLab(set: MetaLabSet): string[] {
  const errors: string[] = []

  if (set.titles.length < LIMITS.titleCount) {
    errors.push(`标题只有 ${set.titles.length} 条，需要 ${LIMITS.titleCount} 条`)
  }

  const tooLong = set.titles.filter((t) => charCount(t.text) > LIMITS.titleMax)
  if (tooLong.length) {
    errors.push(`标题超过 ${LIMITS.titleMax} 字：${tooLong.map((t) => `「${t.text.slice(0, 12)}…」`).join('、')}`)
  }

  const short = shortCount(set)
  if (short < LIMITS.titleMinShort) {
    errors.push(
      `只有 ${short} 条标题在 ${LIMITS.titleShort} 字以内，至少需要 ${LIMITS.titleMinShort} 条（小红书标题上限 20 字）`,
    )
  }

  const empty = set.titles.filter((t) => charCount(t.text) < 6)
  if (empty.length) errors.push('有标题短于 6 字，信息量不够')

  const bad = findBlacklisted(set.titles.map((t) => t.text).join(' '))
  if (bad.length) errors.push(`标题里出现了营销腔词汇：${bad.join('、')}`)

  const emoji = set.titles.reduce((n, t) => n + countEmoji(t.text), 0)
  if (emoji > 0) errors.push('标题里不要用 emoji')

  if (set.tags.length < LIMITS.tagMin) {
    errors.push(`标签只有 ${set.tags.length} 个，至少需要 ${LIMITS.tagMin} 个`)
  }
  const badTags = set.tags.filter((t) => charCount(t.name) > LIMITS.tagMaxChars || charCount(t.name) < 2)
  if (badTags.length) {
    errors.push(`标签长度需在 2–${LIMITS.tagMaxChars} 字之间：${badTags.map((t) => t.name).join('、')}`)
  }
  const hashTags = set.tags.filter((t) => t.name.includes('#') || /\s/.test(t.name))
  if (hashTags.length) errors.push(`标签里不能带 # 或空格：${hashTags.map((t) => t.name).join('、')}`)

  return errors
}

/* ------------------------------------------------------------------ */
/* 兜底修复                                                            */
/* ------------------------------------------------------------------ */

/** 把一条长标题压到 20 字内：优先在标点处断开，断不开才硬截 */
export function compressTitle(text: string, max = LIMITS.titleShort): string {
  const s = cleanTitle(text)
  if (charCount(s) <= max) return s

  const parts = s.split(/[，,：:；;——·]/).map((p) => p.trim()).filter(Boolean)
  let acc = ''
  for (const p of parts) {
    const next = acc ? `${acc}，${p}` : p
    if (charCount(next) > max) break
    acc = next
  }
  if (acc && charCount(acc) >= 6) return acc
  return truncateByChars(s, max, '')
}

export function repairMetaLab(set: MetaLabSet, fallbackPool: MetaLabSet): { data: MetaLabSet; notes: string[] } {
  const notes: string[] = []
  let titles = set.titles.map((t) => {
    if (charCount(t.text) <= LIMITS.titleMax) return t
    notes.push(`「${t.text.slice(0, 10)}…」超过 ${LIMITS.titleMax} 字，已裁剪`)
    return { ...t, text: truncateByChars(t.text, LIMITS.titleMax, '') }
  })

  // 短标题不够 → 把最长的几条压成短句，而不是丢一条新的进来
  if (shortCount({ titles, tags: [] }) < LIMITS.titleMinShort) {
    const need = LIMITS.titleMinShort - shortCount({ titles, tags: [] })
    const byLength = [...titles].sort((a, b) => charCount(b.text) - charCount(a.text))
    const picked = new Set<string>()
    for (const t of byLength) {
      if (picked.size >= need) break
      if (charCount(t.text) <= LIMITS.titleShort) continue
      const short = compressTitle(t.text)
      if (charCount(short) < 6) continue
      picked.add(dedupeKey(short))
      titles.push({ text: short, style: t.style })
    }
    if (picked.size) notes.push(`补了 ${picked.size} 条 20 字内的短标题`)
  }

  // 条数不够 → 用本地候选补齐
  if (titles.length < LIMITS.titleCount) {
    const have = new Set(titles.map((t) => dedupeKey(t.text)))
    for (const c of fallbackPool.titles) {
      if (titles.length >= LIMITS.titleCount) break
      if (have.has(dedupeKey(c.text))) continue
      have.add(dedupeKey(c.text))
      titles.push(c)
    }
    notes.push('标题条数不足，已用本地候选补齐')
  }

  titles = dedupeTitles(titles).slice(0, LIMITS.titleCount)

  let tags = set.tags
  if (tags.length < LIMITS.tagMin) {
    const have = new Set(tags.map((t) => dedupeKey(t.name)))
    for (const t of fallbackPool.tags) {
      if (tags.length >= LIMITS.tagMin) break
      if (have.has(dedupeKey(t.name))) continue
      have.add(dedupeKey(t.name))
      tags.push(t)
    }
    notes.push('标签数量不足，已用原文标签补齐')
  }

  return { data: { titles, tags: dedupeTags(tags).slice(0, LIMITS.tagCount) }, notes }
}

export function parseMetaLabJson(raw: string): { data: MetaLabSet | null; error: string | null } {
  const { value, error } = parseJsonLoose(raw)
  if (error || !value) return { data: null, error: error ?? '空输出' }
  return { data: normalizeMetaLab(value), error: null }
}

/* ------------------------------------------------------------------ */
/* 本地兜底：不调大模型时也得给出可用的 8 条                              */
/* ------------------------------------------------------------------ */

/**
 * 取第一个分句（在标点处断开），用来造短标题。
 * 括号必须配平：`我讨厌「话多而不自知，无礼而不自明」的人群` 在逗号处断开会得到
 * 一个引号没闭合的残句，比不切还难看。
 */
function firstClause(text: string): string {
  const s = text.trim().replace(/[。！？]$/, '')
  const cut = s.split(/[，,：:；;——]/)[0]?.trim()
  if (!cut || charCount(cut) < 4) return s
  const open = (cut.match(/「/g) ?? []).length
  const close = (cut.match(/」/g) ?? []).length
  if (open !== close) return s
  return cut
}

/**
 * 这些标题没有信息量，拿来当主语只会得到「开篇到底难在哪」这种废话。
 * 除了「开篇/结语」这类固定词，还要挡掉「第一个小节」——有些模板文章
 * 的 ## 就是按序号写的，短标签会把它当成实义词。
 */
const GENERIC_HEADING = /^(开篇|前言|序|引言|引子|结语|结尾|小结|总结|后记|附录|正文|写在前面)/
/** 「第 1 部分」「第二部分」「第三回」—— 序号后面常带空格，必须一起吃掉 */
const NUMBERED_HEADING = /^第\s*[一二三四五六七八九十百零\d]+\s*[个章节部分回篇]/

/** 这个标题能不能当主语/标签用 */
function meaningful(heading: string): boolean {
  const raw = heading.replace(/^[\d\s.、,，:：\-—_·•#*【】\[\]（）()]+/, '').trim()
  if (!raw || raw.length < 2) return false
  if (GENERIC_HEADING.test(raw)) return false
  if (NUMBERED_HEADING.test(raw)) return false
  return true
}

/** 挑一个能当主语的词：优先第一个有实义的小节标题，其次分类，最后退到标题 */
function subjectOf(doc: Doc, sections: ArticleSection[]): string {
  for (const s of sections) {
    if (!meaningful(s.heading)) continue
    const label = shortLabel(s.heading)
    if (label && charCount(label) >= 2) return label
  }
  const cat = doc.meta.categories[0]?.trim()
  if (cat) return cat
  return shortLabel(doc.meta.title) || truncateByChars(doc.meta.title, 8, '')
}

/** 正文第一段（跳过标题/列表/代码），导语往往已经把主旨说过一遍 */
function firstParagraph(doc: Doc): string {
  for (const b of doc.blocks) {
    if (b.t !== 'p') continue
    const text = inlineText(b.inline).replace(/\s+/g, ' ').trim()
    if (charCount(text) >= 10) return text
  }
  return ''
}

/**
 * 本地拼装。
 * 原则：只重排原文已有的字句，不新增任何事实 —— 所以这里没有「我踩过的 5 个坑」
 * 这类需要额外断言的模板，只有「关于 X，我是怎么想的」这种中性的框架。
 *
 * 也不用「第 N 节：这一节说了什么」这种填充句：8 条里有 3 条只差一个数字，
 * 等于只给了 6 条候选，还稀释了真正有用的那几条。
 */
export function localMetaLab(doc: Doc, digest: DigestSet | null, sections: ArticleSection[]): MetaLabSet {
  const title = cleanTitle(doc.meta.title)
  const oneLiner = digest?.oneLiner?.trim() ?? ''
  const label = subjectOf(doc, sections)
  const cat = doc.meta.categories[0]?.trim() ?? ''

  const pool: TitleCandidate[] = []
  const push = (text: string, style?: TitleStyle) => {
    const t = cleanTitle(text)
    if (charCount(t) < 4) return
    if (charCount(t) > LIMITS.titleMax) return

    const k = dedupeKey(t)
    // 一条是另一条的前缀 → 只留长的。
    // 「一个格式」和「一个格式，解决图片上传图床失败问题」是同一个标题的两种长度，
    // 两条都留着等于白占一个候选位。
    for (const p of pool) {
      const pk = dedupeKey(p.text)
      if (pk.length < 4 || k.length < 4) continue
      if (pk.startsWith(k) || k.startsWith(pk)) {
        if (k.length > pk.length) {
          p.text = t
          p.style = style ?? p.style
        }
        return
      }
    }

    pool.push({ text: t, style: style ?? guessStyle(t) })
  }

  // 1. 原标题（最稳的一条，通常是作者自己最满意的措辞）
  push(title, 'statement')

  // 2. 全篇一句话（结论前置）
  if (oneLiner) push(oneLiner, 'judgement')

  // 3. 一句话的第一个分句（短标题的主要来源）
  if (oneLiner) push(firstClause(oneLiner), 'statement')

  // 4. 原标题压到 20 字内
  push(compressTitle(title), 'statement')

  // 5. 去掉「我为什么」「关于」这类前缀后的原标题：换个语气，信息不变
  const stripped = title.replace(/^(我为什么|为什么|关于|浅谈|聊聊|说说|记录一下)/, '').trim()
  if (stripped && stripped !== title) push(stripped, 'statement')

  // 6. 疑问式
  if (label) push(`${label}到底难在哪？`, 'question')

  // 7. 做法式
  if (label) push(`关于「${label}」，我的做法和理由`, 'howto')

  // 8. 结构式（节数是事实，不是编的）
  if (label && sections.length > 1) push(`${label}：分成 ${sections.length} 步来说`, 'number')

  // 9. 分类 + 判断
  if (cat && cat !== label) push(`${cat}这件事，我是这么想的`, 'judgement')

  // 10. 对比式：原标题里本来就有转折词时才有意义，硬造会变成假对比
  if (/不是|而是|之前|之后|以前|现在/.test(title)) push(`不是「${label}」的问题`, 'contrast')

  // 11. 作者自写摘要里的句子：往往比正文第一句更像「结论」
  const summary = doc.meta.summary?.trim() ?? ''
  if (summary && summary !== oneLiner) {
    push(firstClause(summary), 'statement')
    push(compressTitle(summary), 'statement')
  }

  // 11b. 正文第一段：导语通常已经把全文的主旨说过一遍，是最像标题的原料
  const lead = firstParagraph(doc)
  if (lead && lead !== summary && lead !== oneLiner) {
    push(firstClause(lead), 'statement')
    push(compressTitle(firstClause(lead)), 'statement')
  }

  // 12. 有实义的小节标题本身就是好标题的原料（「改稿：第二天只动结构」这种）
  for (const s of sections) {
    if (pool.length >= LIMITS.titleCount + 2) break
    if (!meaningful(s.heading)) continue
    const l = shortLabel(s.heading)
    if (charCount(l) < 3 || l === label) continue
    push(`${l}：我是怎么做的`, 'howto')
  }

  // 13. 摘要压到 20 字：和上面那条是同一个来源的两个长度，放在最后当补充
  if (summary) push(compressTitle(summary), 'statement')

  // 14. front matter 的标签是作者自己的分类体系，最贴近内容，而且不用另造词
  const tagList = doc.meta.tags.map((t) => t.trim()).filter((t) => t && t !== label && t !== cat)
  if (tagList[0]) push(`${tagList[0]}：我的一点经验`, 'howto')
  if (tagList[1]) push(`${tagList[1]}这件事，我的看法`, 'judgement')

  // 15. 还凑不满时用中性框架补位。
  // 这几条不新增任何事实，只是换一个说法描述「这是关于 X 的一篇内容」，
  // 所以放在最后 —— 前面能凑够 8 条时根本不会用到它们。
  const frames: { text: string; style: TitleStyle }[] = label
    ? [
        { text: `关于「${label}」的一些记录`, style: 'statement' },
        { text: `写「${label}」的时候我在想什么`, style: 'question' },
        { text: `${label}：几点具体的想法`, style: 'statement' },
      ]
    : []
  for (const f of frames) {
    if (pool.length >= LIMITS.titleCount) break
    push(f.text, f.style)
  }

  // 短标题不够就把最长的压下来
  let titles = dedupeTitles(pool).slice(0, LIMITS.titleCount)
  if (shortCount({ titles, tags: [] }) < LIMITS.titleMinShort) {
    const extra: TitleCandidate[] = []
    for (const t of [...titles].sort((a, b) => charCount(b.text) - charCount(a.text))) {
      if (shortCount({ titles: [...titles, ...extra], tags: [] }) >= LIMITS.titleMinShort) break
      const s = compressTitle(t.text)
      if (charCount(s) >= 6) extra.push({ text: s, style: t.style })
    }
    titles = dedupeTitles([...titles, ...extra]).slice(0, LIMITS.titleCount)
  }

  // 标签：原文标签 + 分类 + 小节标题，全部是原文里已有的词
  const tagPool: TagSuggestion[] = []
  const seen = new Set<string>()
  const addTag = (raw: string) => {
    const name = cleanTag(raw)
    const k = dedupeKey(name)
    if (!name || charCount(name) < 2 || charCount(name) > LIMITS.tagMaxChars || seen.has(k)) return
    seen.add(k)
    tagPool.push({ name })
  }
  doc.meta.tags.forEach(addTag)
  doc.meta.categories.forEach(addTag)
  // 小节标题只有当它有实义时才当标签用 —— 否则会产出「第1部分」这种标签
  sections.filter((s) => meaningful(s.heading)).forEach((s) => addTag(shortLabel(s.heading)))
  addTag(cat)

  return { titles, tags: tagPool.slice(0, LIMITS.tagCount) }
}

/* ------------------------------------------------------------------ */
/* 执行                                                                */
/* ------------------------------------------------------------------ */

export interface MetaLabOutcome {
  state: MetaLabState
  notes: string[]
}

export async function runMetaLab(
  doc: Doc,
  digest: DigestSet | null,
  sections: ArticleSection[],
  signal?: AbortSignal,
  cb?: { onStream?: (text: string) => void },
): Promise<MetaLabOutcome> {
  const { provider, reason } = resolveProvider()
  const local = localMetaLab(doc, digest, sections)

  if (!provider || !provider.available()) {
    return {
      state: {
        ...emptyMetaLabState,
        status: 'done',
        result: local,
        fallback: true,
        error: reason,
        providerLabel: '本地拼装',
      },
      notes: [reason],
    }
  }

  const base = buildMetaLabPrompt(doc, digest, sections)

  const run = await runJson<MetaLabSet>({
    provider,
    base: { system: base.system, user: base.user, compressed: false },
    parse: (raw) => parseMetaLabJson(raw),
    validate: (d) => validateMetaLab(d),
    repair: (d) => repairMetaLab(d, local),
    signal,
    cb: { onStream: cb?.onStream },
  })

  if (run.aborted) return { state: { ...emptyMetaLabState }, notes: [] }

  if (!run.data) {
    return {
      state: {
        ...emptyMetaLabState,
        status: 'done',
        result: local,
        fallback: true,
        error: run.error,
        retries: run.retries,
        providerLabel: provider.label,
      },
      notes: [...run.notes, run.error ?? ''],
    }
  }

  return {
    state: {
      ...emptyMetaLabState,
      status: 'done',
      result: run.data,
      error: run.error,
      fallback: false,
      retries: run.retries,
      providerLabel: provider.label,
    },
    notes: run.notes,
  }
}

/** 标题角度的中文名，UI 直接用 */
export function styleLabel(style: TitleStyle): string {
  return titleStyleLabels[style] ?? '陈述'
}

/** 给错误信息兜底：provider 抛错时给出人话 */
export function describeMetaLabError(e: unknown): string {
  return describeAIError(e)
}
