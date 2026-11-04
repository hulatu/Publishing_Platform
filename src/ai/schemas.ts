/**
 * AI 输出的解析、规范化与校验
 *
 * 四层防线，两段流水线各有一套：
 * 1. parse*Json —— 从可能带 markdown 围栏 / 前后缀说明的文本里抠出 JSON
 * 2. normalize*  —— 把结构不规范的数据强制收敛成预期形状（不抛错）
 * 3. validate*   —— 按硬限制逐项检查，产出人可读的错误列表，用于带错误重试
 * 4. repair*     —— 重试仍失败时硬裁到限制内并标注，保证永远有可用输出
 */

import { charCount, countEmoji, findBlacklisted, truncateByChars, truncateByWeight, weightedLength } from '../core/cjk'
import type { ArticleSection } from '../core/sections'
import { LIMITS, type AIResultSet, type DigestSet, type RewriteId, type SectionDigest } from './types'

/* ------------------------------------------------------------------ */
/* 1. 抠 JSON                                                          */
/* ------------------------------------------------------------------ */

export interface ParseResult {
  data: AIResultSet | null
  error: string | null
  raw: string
}

/** 去掉 markdown 代码围栏，取出最外层的 JSON 对象 */
export function extractJsonText(raw: string): string {
  let s = raw.trim()

  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s)
  if (fence) s = fence[1].trim()

  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1)
  }
  return s
}

/** 解析任意 JSON，失败时返回可读错误 */
export function parseJsonLoose(raw: string): { value: unknown; error: string | null } {
  const text = extractJsonText(raw)
  try {
    return { value: JSON.parse(text), error: null }
  } catch (e) {
    return { value: null, error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

/* ------------------------------------------------------------------ */
/* 2. 基础类型收敛                                                      */
/* ------------------------------------------------------------------ */

function asString(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  return ''
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => asString(x)).filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* 3. 章节摘要：解析 / 规范化 / 校验 / 修复                              */
/* ------------------------------------------------------------------ */

/** 空壳开头，命中即判不合格 */
const SHELL_OPENERS = [
  /^(本节|这一节|该节|此节|这部分|本部分|这一部分|该部分)/,
  /^(作者|文章|本文|原文)(认为|指出|提出|介绍|讲述|讨论|阐述|提到|强调|说明)/,
  /^(主要|重点)?(介绍|讲述|讨论|阐述|说明|描述)了/,
  /^(综上|总体|总而言之|总的来说|由此可见|不难看出)/,
]

export function looksLikeShell(text: string): boolean {
  const s = text.trim().replace(/^[「『"']/, '')
  return SHELL_OPENERS.some((re) => re.test(s))
}

/** 把模型输出收敛成 DigestSet；heading 一律以原文为准，不信模型 */
export function normalizeDigest(input: unknown, sections: ArticleSection[]): DigestSet {
  const byIndex = new Map<number, string>()
  let oneLiner = ''

  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  oneLiner = asString(obj.oneLiner ?? obj.one_liner ?? obj.oneliner ?? obj.summary ?? obj['一句话'])

  const rawList = obj.sections ?? obj['章节'] ?? obj.items
  if (Array.isArray(rawList)) {
    rawList.forEach((item, i) => {
      if (typeof item === 'string') {
        byIndex.set(i + 1, item.trim())
        return
      }
      if (!item || typeof item !== 'object') return
      const o = item as Record<string, unknown>
      const idx = Number(o.index ?? o.id ?? o.n ?? i + 1)
      const summary = asString(o.summary ?? o.digest ?? o.text ?? o.content)
      if (!summary) return
      byIndex.set(Number.isFinite(idx) && idx > 0 ? Math.floor(idx) : i + 1, summary)
    })
  } else if (obj.sections && typeof obj.sections === 'object') {
    // {"sections": {"1": "...", "2": "..."}} 这种形状
    for (const [k, v] of Object.entries(obj.sections as Record<string, unknown>)) {
      const idx = Number(k)
      const summary = asString(v)
      if (Number.isFinite(idx) && summary) byIndex.set(Math.floor(idx), summary)
    }
  }

  const out: SectionDigest[] = sections.map((s) => ({
    index: s.index,
    heading: s.heading,
    summary: byIndex.get(s.index) ?? '',
  }))

  return { sections: out, oneLiner }
}

/** 逐项校验摘要，返回人可读错误；空数组表示通过 */
export function validateDigest(digest: DigestSet, sections: ArticleSection[]): string[] {
  const errors: string[] = []

  if (digest.sections.length !== sections.length) {
    errors.push(`sections 应该有 ${sections.length} 项，实际只有 ${digest.sections.length} 项`)
  }

  const missing: number[] = []
  const tooShort: string[] = []
  const tooLong: string[] = []
  const shell: string[] = []

  for (const s of digest.sections) {
    if (!s.summary) {
      missing.push(s.index)
      continue
    }
    const c = charCount(s.summary)
    if (c < LIMITS.digestMin) tooShort.push(`第 ${s.index} 节只有 ${c} 字`)
    else if (c > LIMITS.digestMax) tooLong.push(`第 ${s.index} 节有 ${c} 字`)
    if (looksLikeShell(s.summary)) shell.push(`第 ${s.index} 节以「${s.summary.slice(0, 6)}…」开头`)
  }

  if (missing.length) errors.push(`缺少摘要的小节：${missing.map((i) => `第 ${i} 节`).join('、')}`)
  if (tooShort.length) errors.push(`摘要太短（需 ≥${LIMITS.digestMin} 字）：${tooShort.join('；')}`)
  if (tooLong.length) errors.push(`摘要太长（需 ≤${LIMITS.digestMax} 字）：${tooLong.join('；')}`)
  if (shell.length) {
    errors.push(
      `出现了空壳开头，必须直接说内容本身：${shell.join('；')}。禁止「本节」「这一节」「作者认为」「主要介绍了」「综上所述」这类开头`,
    )
  }

  const ol = charCount(digest.oneLiner)
  if (ol === 0) errors.push('oneLiner 为空')
  else if (ol > LIMITS.oneLinerMax) errors.push(`oneLiner 有 ${ol} 字，超过 ${LIMITS.oneLinerMax} 字上限`)

  return errors
}

/** 重试仍失败时使用：把超长摘要硬裁到上限，缺失的留给调用方用本地抽取补 */
export function repairDigest(digest: DigestSet): { data: DigestSet; notes: string[] } {
  const notes: string[] = []
  const sectionsOut = digest.sections.map((s) => {
    if (!s.summary) return s
    if (charCount(s.summary) > LIMITS.digestMax) {
      notes.push(`第 ${s.index} 节摘要已裁剪到 ${LIMITS.digestMax} 字`)
      return { ...s, summary: truncateByChars(s.summary, LIMITS.digestMax, '…') }
    }
    return s
  })

  let oneLiner = digest.oneLiner
  if (charCount(oneLiner) > LIMITS.oneLinerMax) {
    notes.push(`oneLiner 已裁剪到 ${LIMITS.oneLinerMax} 字`)
    oneLiner = truncateByChars(oneLiner, LIMITS.oneLinerMax, '')
  }

  return { data: { sections: sectionsOut, oneLiner }, notes }
}

export function parseDigestJson(raw: string, sections: ArticleSection[]): { data: DigestSet | null; error: string | null } {
  const { value, error } = parseJsonLoose(raw)
  if (error || !value) return { data: null, error: error ?? '空输出' }
  return { data: normalizeDigest(value, sections), error: null }
}

/* ------------------------------------------------------------------ */
/* 4. 平台文案：规范化                                                  */
/* ------------------------------------------------------------------ */

/** 把任意形状的数据收敛成 AIResultSet，缺的字段直接不出现 */
export function normalizeSet(input: unknown): AIResultSet {
  const out: AIResultSet = {}
  if (!input || typeof input !== 'object') return out
  const obj = input as Record<string, unknown>

  const xhs = obj.xhs ?? obj.xiaohongshu ?? obj['小红书']
  if (xhs && typeof xhs === 'object') {
    const o = xhs as Record<string, unknown>
    const title = asString(o.title)
    const body = asString(o.body ?? o.content)
    const tags = asStringArray(o.tags ?? o.hashtags).map((t) => t.replace(/^#+/, '').trim())
    if (title || body) out.xhs = { title, body, tags }
  }

  const tw = obj.twitter ?? obj.x ?? obj.thread
  if (tw) {
    let thread: string[] = []
    if (Array.isArray(tw)) {
      thread = tw
        .map((item) => {
          if (typeof item === 'string') return item.trim()
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>
            return asString(o.text ?? o.content)
          }
          return ''
        })
        .filter(Boolean)
    } else if (typeof tw === 'object') {
      const o = tw as Record<string, unknown>
      thread = asStringArray(o.thread ?? o.tweets)
    }
    if (thread.length) out.twitter = { thread }
  }

  const jike = obj.jike ?? obj['即刻']
  if (jike && typeof jike === 'object') {
    const o = jike as Record<string, unknown>
    const body = asString(o.body ?? o.content ?? o.text)
    if (body) out.jike = { body }
  }

  const weibo = obj.weibo ?? obj['微博']
  if (weibo && typeof weibo === 'object') {
    const o = weibo as Record<string, unknown>
    const text = asString(o.text ?? o.body ?? o.content)
    const topics = asStringArray(o.topics).map((t) => t.replace(/^#+|#+$/g, '').trim())
    if (text) out.weibo = { text, topics }
  }

  return out
}

export function parseAIJson(raw: string): ParseResult {
  const { value, error } = parseJsonLoose(raw)
  if (error || !value) return { data: null, error: error ?? '空输出', raw }
  return { data: normalizeSet(value), error: null, raw }
}

/* ------------------------------------------------------------------ */
/* 5. 平台文案：校验                                                     */
/* ------------------------------------------------------------------ */

function validateXhs(data: AIResultSet, errors: string[]): void {
  if (!data.xhs) return
  const { title, body, tags } = data.xhs
  const tc = charCount(title)
  if (tc === 0) errors.push('xhs.title 为空')
  else if (tc > LIMITS.xhsTitle) errors.push(`xhs.title 有 ${tc} 字，超过 ${LIMITS.xhsTitle} 字上限`)

  const bc = charCount(body)
  if (bc === 0) errors.push('xhs.body 为空')
  else if (bc > LIMITS.xhsBody) errors.push(`xhs.body 有 ${bc} 字，超过 ${LIMITS.xhsBody} 字上限`)

  if (tags.length === 0) errors.push('xhs.tags 为空，至少需要 3 个话题标签')
  if (tags.length > LIMITS.xhsTags) errors.push(`xhs.tags 有 ${tags.length} 个，超过 ${LIMITS.xhsTags} 个上限`)
  if (tags.some((t) => t.includes('#'))) errors.push('xhs.tags 里不能带 # 号')

  const emoji = countEmoji(body)
  if (emoji > 5) errors.push(`xhs.body 有 ${emoji} 个 emoji，超过 5 个上限`)

  const bad = findBlacklisted(`${title}${body}`)
  if (bad.length) errors.push(`xhs 里出现了营销腔词汇：${bad.join('、')}`)

  if (/[!！]\s*$/.test(title)) errors.push('xhs.title 不能以惊叹号结尾（避免标题党）')

  // 结构检查：主体必须有小标题式条目，否则就是「段落堆叠」，正是要修的问题
  const bulletCount = body.split('\n').filter((l) => /^\s*[·•・\-—*]\s*\S/.test(l)).length
  if (bulletCount === 0) {
    errors.push('xhs.body 缺少「· 小标题：一句话说明」形式的要点条目，请按三段式（钩子 / 3–5 条要点 / 收尾）重写')
  }
}

function validateTwitter(data: AIResultSet, errors: string[]): void {
  if (!data.twitter) return
  const { thread } = data.twitter
  if (thread.length === 0) errors.push('twitter.thread 为空')
  if (thread.length > 12) errors.push(`twitter.thread 有 ${thread.length} 条，太多了，请控制在 3–8 条`)
  thread.forEach((t, i) => {
    const w = weightedLength(t)
    if (w > LIMITS.twitterWeighted) {
      errors.push(`twitter.thread 第 ${i + 1} 条加权长度 ${w}，超过 ${LIMITS.twitterWeighted}`)
    }
    if (/^\d+\s*\/\s*\d+/.test(t.trim())) {
      errors.push(`twitter.thread 第 ${i + 1} 条自带编号，请去掉编号（程序会自动加）`)
    }
  })
  const bad = findBlacklisted(thread.join(''))
  if (bad.length) errors.push(`twitter 里出现了营销腔词汇：${bad.join('、')}`)
}

function validateJike(data: AIResultSet, errors: string[]): void {
  if (!data.jike) return
  const c = charCount(data.jike.body)
  if (c === 0) errors.push('jike.body 为空')
  else if (c > LIMITS.jikeBody) errors.push(`jike.body 有 ${c} 字，超过 ${LIMITS.jikeBody} 字上限`)
  const bad = findBlacklisted(data.jike.body)
  if (bad.length) errors.push(`jike 里出现了营销腔词汇：${bad.join('、')}`)
}

function validateWeibo(data: AIResultSet, errors: string[]): void {
  if (!data.weibo) return
  const c = charCount(data.weibo.text)
  if (c === 0) errors.push('weibo.text 为空')
  else if (c > LIMITS.weiboText) errors.push(`weibo.text 有 ${c} 字，超过 ${LIMITS.weiboText} 字上限`)
  if (data.weibo.topics.length > LIMITS.weiboTopics) {
    errors.push(`weibo.topics 有 ${data.weibo.topics.length} 个，最多 ${LIMITS.weiboTopics} 个`)
  }
}

/** 逐项校验，返回人可读的错误列表；空数组表示通过 */
export function validateSet(data: AIResultSet): string[] {
  const errors: string[] = []
  if (!data.xhs && !data.twitter && !data.jike && !data.weibo) {
    return ['四个平台的内容全部缺失，请重新输出完整 JSON']
  }
  validateXhs(data, errors)
  validateTwitter(data, errors)
  validateJike(data, errors)
  validateWeibo(data, errors)
  return errors
}

/** 只校验某一个平台 */
export function validatePlatform(data: AIResultSet, platform: RewriteId): string[] {
  const errors: string[] = []
  if (platform === 'xiaohongshu') {
    if (!data.xhs) return ['缺少 xhs 字段']
    validateXhs(data, errors)
  } else if (platform === 'twitter') {
    if (!data.twitter) return ['缺少 twitter 字段']
    validateTwitter(data, errors)
  } else if (platform === 'jike') {
    if (!data.jike) return ['缺少 jike 字段']
    validateJike(data, errors)
  } else {
    if (!data.weibo) return ['缺少 weibo 字段']
    validateWeibo(data, errors)
  }
  return errors
}

/* ------------------------------------------------------------------ */
/* 6. 平台文案：兜底修复                                                 */
/* ------------------------------------------------------------------ */

export function repairSet(data: AIResultSet): { data: AIResultSet; notes: string[] } {
  const notes: string[] = []
  const out: AIResultSet = { ...data }

  if (out.xhs) {
    const title = truncateByChars(out.xhs.title.replace(/[!！]+$/, ''), LIMITS.xhsTitle, '')
    const body = truncateByChars(out.xhs.body, LIMITS.xhsBody)
    if (title !== out.xhs.title) notes.push('小红书标题已裁剪到 20 字')
    if (body !== out.xhs.body) notes.push('小红书正文已裁剪到 1000 字')
    const tags = out.xhs.tags.map((t) => t.replace(/^#+/, '')).slice(0, LIMITS.xhsTags)
    out.xhs = { title, body, tags }
  }

  if (out.twitter) {
    const thread = out.twitter.thread.map((t) => {
      const cleaned = t.replace(/^\s*\d+\s*\/\s*\d+\s*/, '')
      if (weightedLength(cleaned) > LIMITS.twitterBudget) {
        notes.push('部分推文超过 280 加权字符，已截断')
        return truncateByWeight(cleaned, LIMITS.twitterBudget)
      }
      return cleaned
    })
    out.twitter = { thread: thread.slice(0, 12) }
  }

  if (out.jike && charCount(out.jike.body) > LIMITS.jikeBody) {
    notes.push('即刻正文已裁剪到 500 字')
    out.jike = { body: truncateByChars(out.jike.body, LIMITS.jikeBody) }
  }

  if (out.weibo && charCount(out.weibo.text) > LIMITS.weiboText) {
    notes.push('微博正文已裁剪到 140 字')
    out.weibo = {
      text: truncateByChars(out.weibo.text, LIMITS.weiboText),
      topics: out.weibo.topics.slice(0, LIMITS.weiboTopics),
    }
  }

  return { data: out, notes }
}
